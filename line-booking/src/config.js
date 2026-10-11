const env = process.env;

function list(value, fallback) {
  return (value ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function numberList(value, fallback) {
  return list(value, fallback)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}

export const config = {
  port: Number(env.PORT ?? 3000),
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),

  shop: {
    name: env.SHOP_NAME ?? '我的小店',
    address: env.SHOP_ADDRESS ?? '',
    timezoneOffset: env.TIMEZONE_OFFSET ?? '+08:00',
    timezoneName: env.TIMEZONE_NAME ?? 'Asia/Taipei',
    slots: list(env.BOOKING_SLOTS, '11:30,12:30,13:30,17:30,18:30,19:30'),
    durationMinutes: Number(env.BOOKING_DURATION_MINUTES ?? 90),
    maxBookingsPerSlot: Number(env.MAX_BOOKINGS_PER_SLOT ?? 5),
    maxDaysAhead: Number(env.MAX_DAYS_AHEAD ?? 30),
  },

  line: {
    channelSecret: env.LINE_CHANNEL_SECRET ?? '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    liffId: env.LIFF_ID ?? '',
    loginChannelId: env.LINE_LOGIN_CHANNEL_ID ?? '',
  },

  google: {
    calendarId: env.GOOGLE_CALENDAR_ID ?? '',
    serviceAccountFile: env.GOOGLE_SERVICE_ACCOUNT_FILE ?? '',
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  },

  reminders: {
    lineMinutes: numberList(env.LINE_REMINDER_MINUTES, '1440,60'),
    calendarPopupMinutes: Number(env.CALENDAR_POPUP_REMINDER_MINUTES ?? 60),
    calendarEmailMinutes: Number(env.CALENDAR_EMAIL_REMINDER_MINUTES ?? 1440),
    checkIntervalSeconds: Number(env.REMINDER_CHECK_INTERVAL_SECONDS ?? 60),
  },

  dataFile: env.DATA_FILE ?? new URL('../data/bookings.json', import.meta.url).pathname,
};

export function liffUrl() {
  return config.line.liffId ? `https://liff.line.me/${config.line.liffId}` : `${config.publicBaseUrl}/`;
}
