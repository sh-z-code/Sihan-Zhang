// LINE Flex Message 樣板
import { formatDisplay } from './time.js';

const BRAND = '#06C755';

/** 在 LINE 內開啟網址時改用外部瀏覽器（Google 登入不支援 LINE 內建瀏覽器） */
export function external(url) {
  return `${url}${url.includes('?') ? '&' : '?'}openExternalBrowser=1`;
}

function row(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#888888', size: 'sm', flex: 2 },
      { type: 'text', text: String(value || '—'), wrap: true, size: 'sm', flex: 5 },
    ],
  };
}

function bookingRows(booking, shop) {
  return [
    row('時間', formatDisplay(new Date(booking.start), shop.timezoneOffset)),
    row('人數', `${booking.people} 位`),
    row('姓名', booking.name),
    row('電話', booking.phone),
    ...(booking.note ? [row('備註', booking.note)] : []),
    row('編號', booking.id),
  ];
}

function bubble({ title, subtitle, color = BRAND, body, buttons }) {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      contents: [
        { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg' },
        ...(subtitle ? [{ type: 'text', text: subtitle, color: '#FFFFFFCC', size: 'xs' }] : []),
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
    ...(buttons?.length && {
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
    }),
  };
}

const uriButton = (label, uri, style = 'primary') => ({
  type: 'button',
  style,
  color: style === 'primary' ? BRAND : undefined,
  action: { type: 'uri', label, uri },
});

const postbackButton = (label, data, displayText) => ({
  type: 'button',
  style: 'secondary',
  action: { type: 'postback', label, data, displayText },
});

export function bookingEntryMessage(shop, liffUrl) {
  return {
    type: 'flex',
    altText: `${shop.name} 線上訂位`,
    contents: bubble({
      title: `${shop.name} 線上訂位`,
      body: [
        { type: 'text', text: '點下方按鈕選擇日期、時段與人數，完成後會自動加入日曆並在用餐前提醒您。', wrap: true, size: 'sm' },
      ],
      buttons: [uriButton('立即訂位', liffUrl), postbackButton('查詢我的訂位', 'action=list', '我的訂位')],
    }),
  };
}

export function bookingConfirmedMessage(booking, shop, calendarUrl) {
  return {
    type: 'flex',
    altText: `訂位成功：${formatDisplay(new Date(booking.start), shop.timezoneOffset)}`,
    contents: bubble({
      title: '✅ 訂位成功',
      subtitle: shop.name,
      body: bookingRows(booking, shop),
      buttons: [
        uriButton('加入我的 Google 日曆', external(calendarUrl)),
        postbackButton('取消訂位', `action=cancel&id=${booking.id}`, '取消訂位'),
      ],
    }),
  };
}

export function reminderMessage(booking, shop, calendarUrl, minutesBefore) {
  const when = minutesBefore >= 1440 ? `${Math.round(minutesBefore / 1440)} 天後` : minutesBefore >= 60 ? `${Math.round(minutesBefore / 60)} 小時後` : `${minutesBefore} 分鐘後`;
  return {
    type: 'flex',
    altText: `訂位提醒：${when}在 ${shop.name} 用餐`,
    contents: bubble({
      title: '⏰ 訂位提醒',
      subtitle: `${when}見！`,
      color: '#FF9F0A',
      body: [
        ...bookingRows(booking, shop),
        ...(shop.address ? [row('地址', shop.address)] : []),
      ],
      buttons: [
        uriButton('查看日曆', external(calendarUrl)),
        ...(shop.address
          ? [uriButton('導航', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`, 'secondary')]
          : []),
        postbackButton('無法前往，取消訂位', `action=cancel&id=${booking.id}`, '取消訂位'),
      ],
    }),
  };
}

export function myBookingsMessage(bookings, shop, calendarUrlFor) {
  if (!bookings.length) return { type: 'text', text: '目前沒有即將到來的訂位喔！輸入「訂位」即可預約。' };
  return {
    type: 'flex',
    altText: `您有 ${bookings.length} 筆訂位`,
    contents: {
      type: 'carousel',
      contents: bookings.slice(0, 12).map((b) =>
        bubble({
          title: '我的訂位',
          subtitle: shop.name,
          body: bookingRows(b, shop),
          buttons: [
            uriButton('加入 Google 日曆', external(calendarUrlFor(b))),
            postbackButton('取消訂位', `action=cancel&id=${b.id}`, '取消訂位'),
          ],
        }),
      ),
    },
  };
}

export function cancelConfirmMessage(booking, shop) {
  return {
    type: 'template',
    altText: '確定要取消訂位嗎？',
    template: {
      type: 'confirm',
      text: `確定要取消 ${formatDisplay(new Date(booking.start), shop.timezoneOffset)} 的訂位嗎？`,
      actions: [
        { type: 'postback', label: '確定取消', data: `action=cancel_confirmed&id=${booking.id}`, displayText: '確定取消' },
        { type: 'postback', label: '保留', data: 'action=noop', displayText: '保留訂位' },
      ],
    },
  };
}

export const text = (t) => ({ type: 'text', text: t });
