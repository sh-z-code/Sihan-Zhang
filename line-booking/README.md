# LINE 訂位系統 × Google 日曆 × 自動提醒

顧客在 LINE 官方帳號輸入「訂位」→ 開啟訂位表單（LIFF）→ 送出後：

1. **店家 Google 日曆**自動新增一筆訂位事件（含姓名、電話、人數、備註），並設定日曆提醒（預設 1 天前寄 Email、1 小時前跳通知）。
2. **顧客 LINE** 收到確認卡片，按「加入我的 Google 日曆」就能存到自己的日曆。
3. **用餐前自動提醒**：預設 1 天前與 1 小時前，透過 LINE 推播提醒卡片（含導航、取消按鈕）。
4. 顧客可在 LINE 輸入「我的訂位」查詢或取消；取消後店家日曆事件會自動刪除、名額釋出。

```
顧客 ──LINE──▶ 官方帳號 ──webhook──▶ 本系統 ──▶ Google 日曆（店家）
  │                                    │
  └──── LIFF 訂位表單 ─── API ──────────┘──▶ LINE 推播：確認 / 提醒
```

## 功能一覽

| 功能 | 說明 |
| --- | --- |
| 關鍵字回覆 | 「訂位／預約／訂桌」回覆訂位卡片；「我的訂位／查詢訂位／取消訂位」列出訂位。其他訊息不回覆，留給真人客服 |
| 加入好友歡迎訊息 | 自動附上訂位按鈕 |
| 訂位表單 | 選日期 → 顯示各時段剩餘名額 → 填人數、姓名、電話、備註 |
| 名額控管 | 每時段上限 `MAX_BOOKINGS_PER_SLOT`，同時送出也不會超賣 |
| 店家日曆 | 服務帳戶自動建立／刪除事件，含日曆提醒 |
| 顧客日曆 | 「加入 Google 日曆」連結（以外部瀏覽器開啟，避免 LINE 內建瀏覽器無法登入 Google） |
| LINE 提醒 | 可設定多個時間點；伺服器重啟後不會重複發送，錯過的提醒只補發一則 |
| 安全性 | 驗證 webhook 簽章；訂位 API 驗證 LIFF ID token，無法冒用他人身分 |

## 一、準備 LINE

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立 Provider。
2. **Messaging API channel**（官方帳號）
   - `Basic settings` → 複製 **Channel secret** → `LINE_CHANNEL_SECRET`
   - `Messaging API` → 產生 **Channel access token (long-lived)** → `LINE_CHANNEL_ACCESS_TOKEN`
   - Webhook URL 填 `https://你的網域/webhook`，開啟 **Use webhook**
   - 在 [LINE Official Account Manager](https://manager.line.biz/) 的回應設定中，關閉「自動回應訊息」（否則會跟本系統重複回覆），聊天可保持開啟
3. **LINE Login channel**（同一個 Provider 下）
   - 複製 **Channel ID** → `LINE_LOGIN_CHANNEL_ID`
   - `LIFF` 分頁 → Add：
     - Size：`Full` 或 `Tall`
     - Endpoint URL：`https://你的網域/`
     - Scopes：勾選 **openid**、**profile**
   - 複製 **LIFF ID** → `LIFF_ID`
4. （建議）在官方帳號的圖文選單加一個按鈕，動作設為連結 `https://liff.line.me/你的LIFF_ID`。

## 二、準備 Google 日曆

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案，啟用 **Google Calendar API**。
2. `IAM 與管理` → `服務帳戶` → 建立服務帳戶 → `金鑰` → 新增 JSON 金鑰，下載後存為 `service-account.json`（放在專案根目錄，已加入 `.gitignore`，**不要上傳到 GitHub**）。
3. 打開店家的 Google 日曆 → 要接收訂位的日曆 → `設定和共用`：
   - 「與特定使用者共用」加入服務帳戶的 email（`xxx@xxx.iam.gserviceaccount.com`），權限選 **變更活動**
   - 往下找到「整合日曆」的 **日曆 ID** → `GOOGLE_CALENDAR_ID`

> 若沒設定 Google 日曆，系統仍可運作，只是不會寫入店家日曆（顧客的「加入 Google 日曆」連結不受影響）。

## 三、安裝與啟動

需要 Node.js 20.6 以上。

```bash
cd line-booking
cp .env.example .env     # 填入上面取得的各項設定
npm install
npm start
```

本機開發時，LINE 需要 https 網址，可用 [ngrok](https://ngrok.com/)：

```bash
ngrok http 3000
# 把產生的 https 網址填入 PUBLIC_BASE_URL、LINE webhook URL、LIFF Endpoint URL
```

執行測試：

```bash
npm test
```

## 四、部署

任何能長時間執行 Node.js 的主機都可以（Render、Railway、Fly.io、GCP Cloud Run 設最小執行個體 1、VPS 等）。注意：

- **提醒排程在程式內執行**，主機不能休眠（免費方案常會休眠，提醒就會延遲）。
- 訂位資料存在 `data/bookings.json`，主機需要**持久化磁碟**；若平台不支援，請改接資料庫（只要替換 `src/store.js`，介面不變）。
- 金鑰可用環境變數 `GOOGLE_SERVICE_ACCOUNT_JSON` 直接放整份 JSON，不必上傳檔案。

## 設定說明（`.env`）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `SHOP_NAME` / `SHOP_ADDRESS` | | 顯示在訊息與日曆上；地址會產生導航按鈕 |
| `BOOKING_SLOTS` | `11:30,12:30,...` | 可訂位時段 |
| `BOOKING_DURATION_MINUTES` | `90` | 日曆事件長度 |
| `MAX_BOOKINGS_PER_SLOT` | `5` | 每時段組數上限 |
| `MAX_DAYS_AHEAD` | `30` | 最多可提前幾天訂 |
| `LINE_REMINDER_MINUTES` | `1440,60` | LINE 提醒時間點（分鐘前） |
| `CALENDAR_POPUP_REMINDER_MINUTES` | `60` | 店家日曆跳出通知（0 = 關閉） |
| `CALENDAR_EMAIL_REMINDER_MINUTES` | `1440` | 店家日曆 Email 提醒（0 = 關閉） |

## 專案結構

```
line-booking/
├── public/index.html   # LIFF 訂位表單
├── src/
│   ├── server.js       # Express：webhook、API、提醒排程
│   ├── booking.js      # 訂位邏輯：驗證、名額、日曆、通知、提醒
│   ├── calendar.js     # Google 日曆（服務帳戶 + 加入日曆連結）
│   ├── line.js         # LINE API、簽章與 ID token 驗證
│   ├── messages.js     # Flex Message 樣板
│   ├── store.js        # JSON 檔案儲存
│   ├── time.js         # 時區工具
│   └── config.js       # 環境變數
└── test/               # node:test 單元測試
```
