// Google 日曆串接：
// 1. 店家日曆：用服務帳戶自動建立／刪除事件，並設定日曆提醒。
// 2. 顧客日曆：產生「加入 Google 日曆」連結，顧客在 LINE 點一下就能存到自己的日曆。
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { toGoogleUtc } from './time.js';

const API = 'https://www.googleapis.com/calendar/v3';

/** 產生「加入 Google 日曆」網址（不需要任何授權） */
export function addToCalendarUrl({ title, start, end, details = '', location = '', timezoneName }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGoogleUtc(start)}/${toGoogleUtc(end)}`,
    details,
    location,
  });
  if (timezoneName) params.set('ctz', timezoneName);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export class ShopCalendar {
  constructor({ calendarId, serviceAccountFile, serviceAccountJson, popupMinutes, emailMinutes, timezoneName }) {
    this.calendarId = calendarId;
    this.popupMinutes = popupMinutes;
    this.emailMinutes = emailMinutes;
    this.timezoneName = timezoneName;

    let credentials = null;
    if (serviceAccountJson) credentials = JSON.parse(serviceAccountJson);
    else if (serviceAccountFile) {
      try {
        credentials = JSON.parse(readFileSync(serviceAccountFile, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    this.enabled = Boolean(calendarId && credentials);
    if (this.enabled) {
      this.auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/calendar.events'] });
    } else {
      console.warn('[calendar] 未設定 GOOGLE_CALENDAR_ID 或服務帳戶金鑰，將略過寫入店家 Google 日曆。');
    }
  }

  eventsUrl(eventId = '') {
    const base = `${API}/calendars/${encodeURIComponent(this.calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  reminderOverrides() {
    const overrides = [];
    if (this.popupMinutes > 0) overrides.push({ method: 'popup', minutes: this.popupMinutes });
    if (this.emailMinutes > 0) overrides.push({ method: 'email', minutes: this.emailMinutes });
    return overrides;
  }

  /** 建立店家日曆事件，回傳 event id；未設定時回傳 null */
  async createEvent({ summary, description, location, start, end, bookingId }) {
    if (!this.enabled) return null;
    const client = await this.auth.getClient();
    const res = await client.request({
      url: this.eventsUrl(),
      method: 'POST',
      data: {
        summary,
        description,
        location,
        start: { dateTime: start.toISOString(), timeZone: this.timezoneName },
        end: { dateTime: end.toISOString(), timeZone: this.timezoneName },
        reminders: { useDefault: false, overrides: this.reminderOverrides() },
        extendedProperties: { private: { bookingId } },
      },
    });
    return res.data.id;
  }

  async deleteEvent(eventId) {
    if (!this.enabled || !eventId) return;
    const client = await this.auth.getClient();
    try {
      await client.request({ url: this.eventsUrl(eventId), method: 'DELETE' });
    } catch (err) {
      // 事件已被手動刪除時不視為錯誤
      if (![404, 410].includes(err.response?.status)) throw err;
    }
  }
}
