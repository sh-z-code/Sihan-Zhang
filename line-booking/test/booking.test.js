import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookingService, BookingError } from '../src/booking.js';
import { BookingStore } from '../src/store.js';
import { addToCalendarUrl } from '../src/calendar.js';
import { verifySignature } from '../src/line.js';
import { formatDisplay, toDate } from '../src/time.js';

const shop = {
  name: '測試小店',
  address: '台北市',
  timezoneOffset: '+08:00',
  timezoneName: 'Asia/Taipei',
  slots: ['12:00', '18:00'],
  durationMinutes: 90,
  maxBookingsPerSlot: 2,
  maxDaysAhead: 30,
};

function setup() {
  const store = new BookingStore(join(mkdtempSync(join(tmpdir(), 'booking-')), 'bookings.json'));
  const pushes = [];
  const events = [];
  const calendar = {
    createEvent: async (e) => (events.push(e), `evt-${events.length}`),
    deleteEvent: async (id) => events.push({ deleted: id }),
  };
  const line = { push: async (to, msg) => pushes.push({ to, msg }) };
  const service = new BookingService({ store, calendar, line, shop, reminderMinutes: [1440, 60] });
  return { store, service, pushes, events };
}

// 明天（台灣時間）的日期字串
function tomorrow() {
  return new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
}

const input = (over = {}) => ({ name: '王小明', phone: '0912345678', people: 2, date: tomorrow(), time: '18:00', ...over });

test('時間以台灣時區解讀並轉成 Google 日曆格式', () => {
  const d = toDate('2026-10-12', '18:30', '+08:00');
  assert.equal(d.toISOString(), '2026-10-12T10:30:00.000Z');
  assert.equal(formatDisplay(d, '+08:00'), '2026/10/12（一）18:30');
});

test('產生加入 Google 日曆連結', () => {
  const url = new URL(
    addToCalendarUrl({
      title: '訂位',
      start: toDate('2026-10-12', '18:30', '+08:00'),
      end: toDate('2026-10-12', '20:00', '+08:00'),
      location: '台北市',
      timezoneName: 'Asia/Taipei',
    }),
  );
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('dates'), '20261012T103000Z/20261012T120000Z');
  assert.equal(url.searchParams.get('ctz'), 'Asia/Taipei');
});

test('驗證 LINE webhook 簽章', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = createHmac('sha256', 'secret').update(body).digest('base64');
  assert.ok(verifySignature(body, sig, 'secret'));
  assert.ok(!verifySignature(body, sig, 'wrong'));
  assert.ok(!verifySignature(body, undefined, 'secret'));
});

test('建立訂位：寫入日曆並推播確認', async () => {
  const { service, store, pushes, events } = setup();
  const b = await service.create('U1', '小明', input());
  assert.equal((await store.get(b.id)).calendarEventId, 'evt-1');
  assert.equal(events[0].bookingId, b.id);
  assert.equal(pushes[0].to, 'U1');
  assert.equal(pushes[0].msg.type, 'flex');
});

test('拒絕無效輸入與過去時段', async () => {
  const { service } = setup();
  await assert.rejects(service.create('U1', '', input({ phone: 'abc' })), BookingError);
  await assert.rejects(service.create('U1', '', input({ time: '15:00' })), BookingError);
  await assert.rejects(service.create('U1', '', input({ date: '2020-01-01' })), /過去/);
  await assert.rejects(service.create('U1', '', input({ date: '2099-01-01' })), /30 天/);
  await assert.rejects(service.create('U1', '', input({ date: '2026-02-30' })), BookingError);
});

test('同時段額滿後拒絕（含同時送出）', async () => {
  const { service } = setup();
  const results = await Promise.allSettled([1, 2, 3].map((i) => service.create(`U${i}`, '', input())));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /額滿/);
});

test('取消訂位：只能取消自己的，並刪除日曆事件', async () => {
  const { service, store, events } = setup();
  const b = await service.create('U1', '', input());
  await assert.rejects(service.cancel(b.id, 'U2'), /找不到/);
  await service.cancel(b.id, 'U1');
  assert.equal((await store.get(b.id)).status, 'cancelled');
  assert.deepEqual(events.at(-1), { deleted: 'evt-1' });
  await assert.rejects(service.cancel(b.id, 'U1'), /已經取消/);
});

test('提醒：各時間點只發一次，錯過時只補發最近的一則', () => {
  const { service } = setup();
  const start = new Date('2026-10-12T10:00:00Z');
  const b = { start: start.toISOString(), remindersSent: [] };
  const at = (minutesBefore) => new Date(start - minutesBefore * 60_000);

  assert.equal(service.dueReminders([b], at(1500)).length, 0);
  const [first] = service.dueReminders([b], at(1430));
  assert.deepEqual(first.skip, [1440]);

  b.remindersSent = [1440];
  assert.equal(service.dueReminders([b], at(100)).length, 0);
  assert.deepEqual(service.dueReminders([b], at(50))[0].skip, [60]);

  // 停機錯過兩個時間點 → 合併成一則
  const missed = service.dueReminders([{ start: start.toISOString(), remindersSent: [] }], at(30));
  assert.equal(missed.length, 1);
  assert.deepEqual(missed[0].skip, [1440, 60]);
  assert.equal(missed[0].minutesLeft, 30);
});

test('臨時訂位不會立刻收到已過時間點的提醒', async () => {
  const { service, pushes } = setup();
  const b = await service.create('U1', '', input());
  // 明天 18:00 距離現在 > 1 小時，但可能 < 24 小時
  const minutesLeft = (new Date(b.start) - Date.now()) / 60_000;
  assert.deepEqual(b.remindersSent, [1440, 60].filter((m) => minutesLeft <= m));
  pushes.length = 0;
  await service.sendDueReminders();
  assert.equal(pushes.length, 0);
});
