# LINE Bot Webhook on Supabase Edge Functions

這是一個部署在 Supabase Edge Functions 上的 LINE Bot 後端，用於追蹤群組成員的月度發話量。

## 🌐 線上服務

- **統計頁面**: https://fresh-line-bot.netlify.app
- **管理後台**: https://fresh-line-bot.netlify.app/admin.html
- **API 文件**: https://fresh-line-bot.netlify.app/docs/

## 功能

- ✅ LINE Messaging API webhook 端點
- ✅ 追蹤每個群組中每位使用者的月度訊息數量（僅統計文字訊息）
- ✅ 資料儲存在 Supabase PostgreSQL 資料庫
- ✅ TypeScript + Deno 運行環境
- ✅ 自動驗證 LINE 簽名（HMAC-SHA256）
- ✅ 群組白名單控管（只允許特定群組使用）
- ✅ 群組名稱快取（14 天）與使用者名稱快取（7 天）
- ✅ 管理員批次匯入發話量功能

## 專案結構

```
supabase/
├── config.toml                # Supabase 專案配置
├── functions/
│   ├── _shared/               # 共用程式碼
│   │   ├── cors.ts            # CORS 處理
│   │   └── types.ts           # TypeScript 類型定義
│   ├── line-webhook/          # LINE Webhook 處理
│   │   ├── index.ts
│   │   └── deno.json
│   ├── get-stats/             # 統計資料查詢 API
│   │   ├── index.ts
│   │   └── deno.json
│   └── admin-import/          # 管理員批次匯入 API
│       ├── index.ts
│       └── deno.json
├── migrations/
│   ├── 20231203000000_create_message_counts.sql   # 訊息統計表
│   ├── 20231204000000_add_name_cache.sql          # 名稱快取表
│   └── 20231205000000_add_allowed_groups.sql      # 群組白名單表
└── public/                    # 前端靜態頁面 (部署於 Netlify)
    ├── index.html             # 統計儀表板
    ├── admin.html             # 管理後台
    └── docs/
        └── index.html         # API 文件
```

## 前置需求

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- [Docker](https://www.docker.com/) (本地開發需要)
- [Deno](https://deno.land/) (可選，用於本地測試)
- LINE Developers 帳號和 Bot Channel

## 設定步驟

### 1. 建立 Supabase 專案

1. 前往 [Supabase](https://supabase.com/) 建立新專案
2. 記下你的專案 URL 和 API keys

### 2. 設定 LINE Bot

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立或選擇你的 Messaging API Channel
3. 取得 **Channel Secret** 和 **Channel Access Token**

### 3. 連結本地專案到 Supabase

```bash
# 登入 Supabase
supabase login

# 列出你的專案
supabase projects list

# 連結到你的專案 (替換 YOUR_PROJECT_ID)
supabase link --project-ref YOUR_PROJECT_ID
```

### 4. 設定環境變數

在 Supabase Dashboard 中設定 Edge Functions 的 secrets：

```bash
# 設定 LINE Channel Secret
supabase secrets set LINE_CHANNEL_SECRET=your_line_channel_secret

# 設定 LINE Channel Access Token (如果需要回覆訊息)
supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
```

### 5. 執行資料庫 Migration

```bash
supabase db push
```

### 6. 部署 Edge Functions

```bash
# 部署所有 functions (使用 --no-verify-jwt 讓 LINE 可以直接呼叫)
supabase functions deploy line-webhook --no-verify-jwt
supabase functions deploy get-stats --no-verify-jwt
supabase functions deploy admin-import --no-verify-jwt
```

### 7. 設定群組白名單

在 Supabase Dashboard 的 SQL Editor 中新增允許的群組：

```sql
INSERT INTO allowed_groups (group_id, group_name, added_by, notes)
VALUES ('Cxxxxxxxx', '群組名稱', 'admin', '備註');
```

### 8. 設定 LINE Webhook URL

在 LINE Developers Console 中，將 Webhook URL 設定為：

```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/line-webhook
```

## 本地開發

### 啟動本地 Supabase 環境

```bash
# 啟動所有 Supabase 服務 (需要 Docker)
supabase start

# 執行 Edge Functions
supabase functions serve
```

### 測試 Webhook

```bash
# 測試 line-webhook (需要有效的 LINE 簽名)
curl -X POST http://localhost:54321/functions/v1/line-webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: YOUR_SIGNATURE" \
  -d '{"destination":"xxx","events":[]}'

# 測試 get-stats
curl "http://localhost:54321/functions/v1/get-stats?group_id=Cxxxx&year_month=2024-12" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## API 端點

### POST /functions/v1/line-webhook

LINE Messaging API 的 webhook 端點。自動處理群組訊息並更新統計。

**特性:**
- 僅統計文字訊息（忽略貼圖、圖片等）
- 僅允許白名單內的群組
- 自動快取群組名稱（14 天）和使用者名稱（7 天）

**Headers:**
- `X-Line-Signature`: LINE 簽名 (由 LINE Platform 自動提供)

### GET /functions/v1/get-stats

查詢群組的訊息統計。

**Query Parameters:**
- `action`: 操作類型
  - `groups`: 列出所有有資料的群組
  - `months`: 列出特定群組的所有月份
  - `stats`: 查詢統計資料（預設）
- `group_id`: LINE 群組 ID（`months` 和 `stats` 需要）
- `year_month`: 年月，格式 `YYYY-MM`（`stats` 需要）

**Response 範例 (action=stats):**
```json
{
  "success": true,
  "data": [
    {
      "user_id": "Uxxxx",
      "user_name": "小明",
      "count": 42
    }
  ],
  "group_name": "群組名稱",
  "total_users": 1,
  "total_messages": 42
}
```

### POST /functions/v1/admin-import

管理員批次匯入發話量統計。

**Headers:**
- `X-Admin-Key`: 管理員密鑰（必填）

**Request Body:**
```json
{
  "group_id": "Cxxxxxxxx",
  "year_month": "2025-01",
  "mode": "update",
  "data": "小明: 703\n小華: 621\n小美: 584"
}
```

**mode 選項:**
- `update`: 更新現有資料（保留未提及的使用者）
- `replace`: 取代該月份所有資料

## 資料庫結構

### message_counts 表

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | BIGSERIAL | 主鍵 |
| group_id | TEXT | LINE 群組 ID |
| user_id | TEXT | LINE 使用者 ID |
| year_month | TEXT | 年月 (YYYY-MM) |
| count | INTEGER | 訊息數量 |
| created_at | TIMESTAMPTZ | 建立時間 |
| updated_at | TIMESTAMPTZ | 更新時間 |

### group_names 表（快取）

| 欄位 | 類型 | 說明 |
|------|------|------|
| group_id | TEXT | LINE 群組 ID (主鍵) |
| group_name | TEXT | 群組名稱 |
| updated_at | TIMESTAMPTZ | 更新時間（14 天後過期）|

### user_names 表（快取）

| 欄位 | 類型 | 說明 |
|------|------|------|
| user_id | TEXT | LINE 使用者 ID (主鍵) |
| user_name | TEXT | 使用者顯示名稱 |
| updated_at | TIMESTAMPTZ | 更新時間（7 天後過期）|

### allowed_groups 表（白名單）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | BIGSERIAL | 主鍵 |
| group_id | TEXT | LINE 群組 ID (唯一) |
| group_name | TEXT | 群組名稱（備註用）|
| added_by | TEXT | 新增者 |
| notes | TEXT | 備註 |
| created_at | TIMESTAMPTZ | 建立時間 |

## 故障排除

### 常見問題

1. **Signature validation failed**
   - 確認 `LINE_CHANNEL_SECRET` 設定正確
   - 確認 webhook URL 正確

2. **Group not allowed**
   - 確認群組 ID 已加入 `allowed_groups` 表

3. **Database error**
   - 確認已執行 `supabase db push`
   - 檢查資料庫連線

4. **Function not found**
   - 確認已部署 functions: `supabase functions list`

5. **名稱顯示為 ID**
   - 名稱快取可能已過期，下次發送訊息時會自動更新
   - 或是 Bot 沒有權限取得該使用者的 Profile

### 查看日誌

```bash
# 查看 Edge Functions 日誌
supabase functions logs line-webhook
supabase functions logs get-stats
supabase functions logs admin-import
```

## 環境變數

| 變數名稱 | 說明 |
|---------|------|
| `LINE_CHANNEL_SECRET` | LINE Channel Secret（用於驗證簽名）|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel Access Token（用於 API 呼叫）|
| `LINE_BOT_NAME` | Bot 名稱（用於過濾 Bot 自己的訊息）|
| `ADMIN_SECRET_KEY` | 管理員 API 密鑰 |
| `SUPABASE_URL` | Supabase 專案 URL（自動提供）|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key（自動提供）|

## 授權

MIT License
