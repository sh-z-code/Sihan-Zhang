// 訂位核心邏輯：驗證 → 檢查名額 → 寫入店家日曆 → LINE 通知 → 排程提醒
import { addToCalendarUrl } from './calendar.js';
import { bookingConfirmedMessage, reminderMessage } from './messages.js';
import { toDate, toLocalParts } from './time.js';

export class BookingError extends Error {}

export class BookingService {
  constructor({ store, calendar, line, shop, reminderMinutes }) {
    this.store = store;
    this.calendar = calendar;
    this.line = line;
    this.shop = shop;
    this.reminderMinutes = reminderMinutes;
    this.lock = Promise.resolve();
  }

  /** 依序執行，避免兩人同時訂最後一個名額而超賣 */
  exclusive(fn) {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => {});
    return run;
  }

  /** 前端表單用：可訂日期範圍與各時段剩餘名額 */
  async availability(date, now = new Date()) {
    const slots = [];
    for (const time of this.shop.slots) {
      const taken = await this.store.countForSlot(date, time);
      const remaining = Math.max(0, this.shop.maxBookingsPerSlot - taken);
      const past = toDate(date, time, this.shop.timezoneOffset) <= now;
      slots.push({ time, remaining: past ? 0 : remaining });
    }
    return slots;
  }

  validate(input, now = new Date()) {
    const name = String(input.name ?? '').trim();
    const phone = String(input.phone ?? '').trim();
    const note = String(input.note ?? '').trim().slice(0, 200);
    const people = Number(input.people);
    const { date, time } = input;

    if (!name || name.length > 50) throw new BookingError('請填寫姓名');
    if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) throw new BookingError('請填寫正確的電話號碼');
    if (!Number.isInteger(people) || people < 1 || people > 20) throw new BookingError('人數需為 1–20 位');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BookingError('請選擇日期');
    if (!this.shop.slots.includes(time)) throw new BookingError('請選擇可訂位的時段');

    const start = toDate(date, time, this.shop.timezoneOffset);
    if (Number.isNaN(start.getTime()) || toLocalParts(start, this.shop.timezoneOffset).date !== date) {
      throw new BookingError('日期格式錯誤');
    }
    if (start <= now) throw new BookingError('不能預訂已經過去的時段');
    if (start - now > this.shop.maxDaysAhead * 86_400_000) {
      throw new BookingError(`最多只能預訂 ${this.shop.maxDaysAhead} 天內的時段`);
    }
    const end = new Date(start.getTime() + this.shop.durationMinutes * 60_000);
    return { name, phone, note, people, date, time, start, end };
  }

  calendarUrl(booking) {
    return addToCalendarUrl({
      title: `${this.shop.name} 訂位（${booking.people} 位）`,
      start: new Date(booking.start),
      end: new Date(booking.end),
      details: [`訂位編號：${booking.id}`, `姓名：${booking.name}`, `人數：${booking.people} 位`, booking.note && `備註：${booking.note}`]
        .filter(Boolean)
        .join('\n'),
      location: this.shop.address,
      timezoneName: this.shop.timezoneName,
    });
  }

  async create(lineUserId, displayName, input) {
    const v = this.validate(input);
    const minutesLeft = (v.start - Date.now()) / 60_000;

    const booking = await this.exclusive(async () => {
      if ((await this.store.countForSlot(v.date, v.time)) >= this.shop.maxBookingsPerSlot) {
        throw new BookingError('這個時段已經額滿，請選擇其他時段');
      }
      return this.store.create({
        lineUserId,
        displayName,
        name: v.name,
        phone: v.phone,
        people: v.people,
        note: v.note,
        date: v.date,
        time: v.time,
        start: v.start.toISOString(),
        end: v.end.toISOString(),
        calendarEventId: null,
        // 訂位當下就已經進入的提醒時段不再發送（例如 2 小時前才訂，就不發「1 天前」提醒）
        remindersSent: this.reminderMinutes.filter((m) => minutesLeft <= m),
      });
    });

    try {
      const eventId = await this.calendar.createEvent({
        summary: `【訂位】${booking.name} ${booking.people} 位`,
        description: [
          `電話：${booking.phone}`,
          `人數：${booking.people} 位`,
          booking.note && `備註：${booking.note}`,
          `LINE：${displayName}`,
          `編號：${booking.id}`,
        ]
          .filter(Boolean)
          .join('\n'),
        location: this.shop.address,
        start: v.start,
        end: v.end,
        bookingId: booking.id,
      });
      if (eventId) await this.store.update(booking.id, { calendarEventId: eventId });
    } catch (err) {
      // 日曆寫入失敗不影響訂位成立，僅記錄錯誤讓店家補登
      console.error(`[calendar] 訂位 ${booking.id} 寫入日曆失敗：`, err.message);
    }

    await this.notify(lineUserId, bookingConfirmedMessage(booking, this.shop, this.calendarUrl(booking)));
    return booking;
  }

  async cancel(id, lineUserId) {
    const booking = await this.store.get(id);
    if (!booking || booking.lineUserId !== lineUserId) throw new BookingError('找不到這筆訂位');
    if (booking.status !== 'confirmed') throw new BookingError('這筆訂位已經取消了');
    await this.store.update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    try {
      await this.calendar.deleteEvent(booking.calendarEventId);
    } catch (err) {
      console.error(`[calendar] 訂位 ${id} 刪除日曆事件失敗：`, err.message);
    }
    return booking;
  }

  /**
   * 找出該發送的提醒。每筆訂位、每個提醒時間點只會發一次；
   * 若伺服器停機錯過了，只補發「最接近的那一個」，不會一次連發多則。
   */
  dueReminders(bookings, now = new Date()) {
    const due = [];
    for (const b of bookings) {
      const minutesLeft = (new Date(b.start) - now) / 60_000;
      if (minutesLeft <= 0) continue;
      const passed = this.reminderMinutes.filter((m) => minutesLeft <= m && !b.remindersSent.includes(m));
      if (passed.length) due.push({ booking: b, minutesLeft: Math.round(minutesLeft), skip: passed });
    }
    return due;
  }

  async sendDueReminders(now = new Date()) {
    const due = this.dueReminders(await this.store.confirmedUpcoming(now), now);
    for (const { booking, minutesLeft, skip } of due) {
      try {
        await this.line.push(booking.lineUserId, reminderMessage(booking, this.shop, this.calendarUrl(booking), minutesLeft));
        await this.store.update(booking.id, { remindersSent: [...booking.remindersSent, ...skip] });
        console.log(`[reminder] 已提醒訂位 ${booking.id}（距離 ${minutesLeft} 分鐘）`);
      } catch (err) {
        console.error(`[reminder] 訂位 ${booking.id} 提醒失敗：`, err.message);
      }
    }
    return due.length;
  }

  async notify(to, message) {
    try {
      await this.line.push(to, message);
    } catch (err) {
      console.error('[line] 推播失敗：', err.message);
    }
  }
}
