// 以店家固定時區偏移（例如 +08:00）處理日期時間。

/** 'YYYY-MM-DD' + 'HH:mm' → Date（以店家時區解讀） */
export function toDate(date, time, offset) {
  return new Date(`${date}T${time}:00${offset}`);
}

function offsetMinutes(offset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) throw new Error(`無效的時區偏移：${offset}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Date → 店家時區的 { date: 'YYYY-MM-DD', time: 'HH:mm', weekday: 0-6 } */
export function toLocalParts(d, offset) {
  const shifted = new Date(d.getTime() + offsetMinutes(offset) * 60_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: shifted.getUTCDay() };
}

/** Date → Google 日曆網址用的 UTC 格式 YYYYMMDDTHHmmssZ */
export function toGoogleUtc(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 顯示用：2026/10/12（一）18:30 */
export function formatDisplay(d, offset) {
  const { date, time, weekday } = toLocalParts(d, offset);
  return `${date.replace(/-/g, '/')}（${WEEKDAYS[weekday]}）${time}`;
}
