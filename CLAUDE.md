# Codex-Line-Bot

## Project Overview

LINE Bot that tracks group message counts per user per month, with a cute AI hamster persona ("小清新"). Built on Supabase Edge Functions (Deno) + PostgreSQL, with a static frontend hosted on Netlify.

## Tech Stack

- **Runtime:** Deno 2.x (Supabase Edge Functions)
- **Language:** TypeScript (backend), Vanilla JS (frontend)
- **Database:** PostgreSQL 17 (Supabase)
- **Frontend:** Static HTML/CSS/JS (no frameworks)
- **Hosting:** Supabase (backend) + Netlify (frontend static files)
- **External APIs:** LINE Messaging API, OpenAI API (gpt-4o-mini)
- **Import style:** JSR imports (`jsr:@supabase/supabase-js@2`, `jsr:@std/crypto`)

## Project Structure

```
Codex-Line-Bot/
├── CLAUDE.md
├── netlify.toml              # Netlify config: publish from supabase/public/
├── supabase/
│   ├── config.toml           # Supabase local dev config
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── cors.ts       # CORS headers & preflight handler
│   │   │   └── types.ts      # Shared TypeScript interfaces
│   │   ├── line-webhook/     # POST - LINE webhook handler (main logic)
│   │   │   ├── index.ts
│   │   │   └── deno.json
│   │   ├── get-stats/        # GET - Stats query API
│   │   │   ├── index.ts
│   │   │   └── deno.json
│   │   └── admin-import/     # POST - Batch import API
│   │       ├── index.ts
│   │       └── deno.json
│   ├── migrations/           # SQL migrations (ordered by timestamp)
│   │   ├── 20231203000000_create_message_counts.sql
│   │   ├── 20231204000000_add_name_cache.sql
│   │   └── 20231205000000_add_allowed_groups.sql
│   └── public/               # Static frontend (served by Netlify)
│       ├── index.html        # Stats dashboard
│       ├── admin.html        # Admin import panel
│       └── docs/index.html   # API docs page
```

## Architecture & Data Flow

```
LINE Group Message → LINE Messaging API
    → POST /functions/v1/line-webhook (HMAC-SHA256 verified)
        → Check group whitelist (allowed_groups table)
        → If "@小清新 X月發話": query stats, reply with ranking
        → If "@小清新 <other>": call OpenAI API (or fallback to hardcoded responses)
        → Count text messages: increment_message_count RPC
        → Cache group/user names lazily

Frontend Dashboard → GET /functions/v1/get-stats
    → action=groups | action=months | default (stats by group+month)

Admin Panel → POST /functions/v1/admin-import
    → X-Admin-Key header auth
    → Parse "Name: count" format, lookup user_id by name, upsert
```

## Database Schema

### Tables
- **message_counts** — `(group_id, user_id, year_month)` unique, tracks count per user per month
- **group_names** — Cache of LINE group names (14-day expiry)
- **user_names** — Cache of LINE user display names (7-day expiry)
- **allowed_groups** — Whitelist of group IDs that can use the bot

### Key RPC Functions (called via `supabase.rpc()`)
- `increment_message_count(p_group_id, p_user_id, p_year_month)` — Upsert +1
- `get_group_name(p_group_id)` / `get_user_name(p_user_id)` — Return cached name or NULL if expired
- `upsert_group_name(p_group_id, p_group_name)` / `upsert_user_name(p_user_id, p_user_name)`
- `is_group_allowed(p_group_id)` — Boolean whitelist check

### Security
- RLS enabled on all tables; only `service_role` has access
- Edge functions use `SUPABASE_SERVICE_ROLE_KEY` (not anon key)

## Environment Variables

| Variable | Used in | Description |
|---|---|---|
| `LINE_CHANNEL_SECRET` | line-webhook | HMAC-SHA256 signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | line-webhook | Reply messages & fetch profiles |
| `LINE_BOT_NAME` | line-webhook | Bot mention pattern (default: "Bot") |
| `OPENAI_API_KEY` | line-webhook | AI responses (optional, fallback to hardcoded) |
| `ADMIN_SECRET_KEY` | admin-import | Admin API authentication |
| `SUPABASE_URL` | all functions | Auto-provided by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | all functions | Auto-provided by Supabase |

## Coding Conventions

### Naming
- **Files/dirs:** kebab-case (`line-webhook`, `get-stats`, `admin-import`)
- **DB columns/tables:** snake_case (`group_id`, `year_month`, `message_counts`)
- **TS interfaces:** PascalCase (`LineWebhookEvent`, `MessageCount`)
- **Functions:** camelCase with verb prefix (`parseStatsRequest`, `getUserNameCached`, `cacheUserName`)
- **RPC functions:** snake_case matching DB (`increment_message_count`)
- **Env vars:** UPPER_SNAKE_CASE
- **Query params:** snake_case (`group_id`, `year_month`)

### Patterns
- Each Edge Function uses `Deno.serve(async (req) => { ... })` as entry point
- CORS preflight handled inline at top of each handler (not using shared cors.ts)
- Utility functions defined above main handler in same file
- `async/await` throughout, no `.then()` chains
- Error handling: try/catch at top level, `console.error` for logging
- Supabase client created per-request: `createClient(url, serviceKey)`
- Types defined locally in each function file (not importing from _shared/types.ts)
- Timezone: Asia/Tokyo (UTC+9) for year_month calculation

### Response Format
- All API responses: `{ success, data/error, message? }`
- HTTP status codes used correctly (200, 400, 401, 405, 500)
- Content-Type: `application/json` on all responses

## AI Persona (小清新)

The bot has a character persona used in OpenAI API calls:
- A cute golden hamster (黃金鼠), 3-month-old male
- Uses "窩" instead of "我" (cute self-reference)
- Occasionally says "吱吱" (squeaking)
- Naive, funny, gives emotional support
- Uses Traditional Chinese with occasional typos/注音文
- Model: `gpt-4o-mini`, temperature: 0.9, max_tokens: 230

## Development

### Local Dev
```bash
# Start Supabase locally (Docker required)
supabase start

# Serve Edge Functions locally
supabase functions serve

# Apply migrations
supabase db reset
```

### Local Ports (Supabase)
- API: 54321
- DB: 54322
- Studio: 54323

### Deployment
- Frontend auto-deploys to Netlify on git push
- Edge Functions deployed via `supabase functions deploy <function-name>`
- Set env vars in Supabase Dashboard > Edge Functions > Secrets

## Important Notes

- `line-webhook` has JWT verification **disabled** (`"verify_jwt": false` in deno.json) since LINE sends unauthenticated webhooks; security is via HMAC-SHA256 signature instead
- `get-stats` has JWT verification **enabled** (requires Authorization header)
- `admin-import` has JWT verification **disabled** but requires `X-Admin-Key` header
- Stats requests (`@botname X月發話`) are **not** counted as messages
- Only **text** messages are counted (stickers, images, etc. are ignored)
- The `_shared/` modules exist but are currently **not imported** by the functions — types and CORS are defined inline in each function
- Frontend language: Traditional Chinese (zh-TW)
