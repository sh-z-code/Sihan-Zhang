// LINE Messaging API 與 LINE Login（LIFF ID token 驗證）
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.line.me';

/** 驗證 webhook 的 x-line-signature */
export function verifySignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class LineClient {
  constructor({ channelAccessToken, loginChannelId }) {
    this.token = channelAccessToken;
    this.loginChannelId = loginChannelId;
  }

  async call(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LINE API ${path} 失敗：${res.status} ${await res.text()}`);
  }

  reply(replyToken, messages) {
    return this.call('/v2/bot/message/reply', { replyToken, messages: [].concat(messages) });
  }

  push(to, messages) {
    return this.call('/v2/bot/message/push', { to, messages: [].concat(messages) });
  }

  /** 驗證 LIFF 取得的 ID token，回傳 { userId, name }；失敗丟出錯誤 */
  async verifyIdToken(idToken) {
    const res = await fetch(`${API}/oauth2/v2.1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.loginChannelId }),
    });
    const data = await res.json();
    if (!res.ok || !data.sub) throw new Error(`ID token 驗證失敗：${data.error_description ?? res.status}`);
    return { userId: data.sub, name: data.name ?? '' };
  }
}
