import express from 'express';
import { config, liffUrl } from './config.js';
import { BookingStore } from './store.js';
import { ShopCalendar } from './calendar.js';
import { LineClient, verifySignature } from './line.js';
import { BookingError, BookingService } from './booking.js';
import { bookingEntryMessage, cancelConfirmMessage, myBookingsMessage, text } from './messages.js';
import { toLocalParts } from './time.js';

const { shop } = config;
const store = new BookingStore(config.dataFile);
const line = new LineClient(config.line);
const calendar = new ShopCalendar({
  ...config.google,
  popupMinutes: config.reminders.calendarPopupMinutes,
  emailMinutes: config.reminders.calendarEmailMinutes,
  timezoneName: shop.timezoneName,
});
const bookings = new BookingService({ store, calendar, line, shop, reminderMinutes: config.reminders.lineMinutes });

const app = express();

// ---------- LINE webhook ----------
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  if (!verifySignature(req.body, req.get('x-line-signature'), config.line.channelSecret)) {
    return res.status(401).send('invalid signature');
  }
  res.sendStatus(200); // 先回應 LINE，避免逾時重送
  const { events = [] } = JSON.parse(req.body.toString('utf8'));
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('[webhook] 處理事件失敗：', err);
    }
  }
});

async function handleEvent(event) {
  const userId = event.source?.userId;
  const reply = (messages) => line.reply(event.replyToken, messages);

  if (event.type === 'follow') {
    return reply([text(`歡迎加入 ${shop.name}！輸入「訂位」即可線上預約 🙌`), bookingEntryMessage(shop, liffUrl())]);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const msg = event.message.text.trim();
    if (/我的訂位|查詢訂位|取消訂位/.test(msg)) return replyMyBookings(userId, reply);
    if (/訂位|預約|訂桌/.test(msg)) return reply(bookingEntryMessage(shop, liffUrl()));
    return; // 其他訊息留給真人客服回覆
  }

  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback.data);
    const id = data.get('id');
    switch (data.get('action')) {
      case 'list':
        return replyMyBookings(userId, reply);
      case 'cancel': {
        const booking = await store.get(id);
        if (!booking || booking.lineUserId !== userId || booking.status !== 'confirmed') {
          return reply(text('這筆訂位不存在或已取消。'));
        }
        return reply(cancelConfirmMessage(booking, shop));
      }
      case 'cancel_confirmed':
        try {
          await bookings.cancel(id, userId);
          return reply(text('已為您取消訂位，期待下次光臨！'));
        } catch (err) {
          if (err instanceof BookingError) return reply(text(err.message));
          throw err;
        }
      default:
        return;
    }
  }
}

async function replyMyBookings(userId, reply) {
  const list = await store.upcomingForUser(userId);
  return reply(myBookingsMessage(list, shop, (b) => bookings.calendarUrl(b)));
}

// ---------- 訂位表單 API（LIFF） ----------
app.use(express.json());

async function requireLineUser(req, res, next) {
  const idToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!idToken) return res.status(401).json({ error: '請從 LINE 開啟訂位頁面' });
  try {
    req.lineUser = await line.verifyIdToken(idToken);
    next();
  } catch (err) {
    console.warn('[auth]', err.message);
    res.status(401).json({ error: '登入已過期，請重新開啟訂位頁面' });
  }
}

app.get('/api/config', (req, res) => {
  const today = toLocalParts(new Date(), shop.timezoneOffset).date;
  const last = toLocalParts(new Date(Date.now() + shop.maxDaysAhead * 86_400_000), shop.timezoneOffset).date;
  res.json({ liffId: config.line.liffId, shopName: shop.name, shopAddress: shop.address, today, last });
});

app.get('/api/availability', async (req, res) => {
  const { date } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return res.status(400).json({ error: '日期格式錯誤' });
  res.json({ date, slots: await bookings.availability(date) });
});

app.post('/api/bookings', requireLineUser, async (req, res) => {
  try {
    const booking = await bookings.create(req.lineUser.userId, req.lineUser.name, req.body);
    res.status(201).json({ booking, calendarUrl: bookings.calendarUrl(booking) });
  } catch (err) {
    if (err instanceof BookingError) return res.status(400).json({ error: err.message });
    console.error('[api] 建立訂位失敗：', err);
    res.status(500).json({ error: '系統忙碌中，請稍後再試' });
  }
});

app.use(express.static(new URL('../public', import.meta.url).pathname));

// ---------- 提醒排程 ----------
function startReminderLoop() {
  const tick = () => bookings.sendDueReminders().catch((err) => console.error('[reminder]', err));
  tick();
  return setInterval(tick, config.reminders.checkIntervalSeconds * 1000);
}

app.listen(config.port, () => {
  console.log(`🚀 訂位系統啟動：http://localhost:${config.port}`);
  console.log(`   LINE webhook：${config.publicBaseUrl || '<PUBLIC_BASE_URL>'}/webhook`);
  startReminderLoop();
});
