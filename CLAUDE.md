# Codex-Line-Bot

## Project Overview

LINE Bot that tracks group message counts per user per month, with a cute AI hamster persona ("小清新"). Built on Supabase Edge Functions (Deno) + PostgreSQL, with a static frontend hosted on Netlify.

## Tech Stack

- **Runtime:** Deno 2.x (Supabase Edge Functions)
- **Language:** TypeScript (backend), Vanilla JS (frontend)
- **Database:** PostgreSQL 17 (Supabase)
- **Frontend:** Static HTML/CSS/JS (no frameworks)
- **Hosting:** Supabase (backend) + Netlify (frontend static files)
- **External APIs:** LINE Messaging API, OpenAI API (gpt-5-nano)
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
│   │   ├── admin-import/     # POST - Batch import API
│   │   │   ├── index.ts
│   │   │   └── deno.json
│   │   └── admin-knowledge/  # GET/POST/PUT/DELETE - Knowledge base CRUD API
│   │       ├── index.ts
│   │       └── deno.json
│   ├── migrations/           # SQL migrations (ordered by timestamp)
│   │   ├── 20231203000000_create_message_counts.sql
│   │   ├── 20231204000000_add_name_cache.sql
│   │   ├── 20231205000000_add_allowed_groups.sql
│   │   ├── 20260304000000_add_event_dedup.sql
│   │   ├── 20260304100000_enable_rls_on_remaining_tables.sql
│   │   ├── 20260304200000_set_function_search_path.sql
│   │   ├── 20260305000000_add_daily_summary.sql
│   │   └── 20260306000000_add_knowledge_base.sql
│   └── public/               # Static frontend (served by Netlify)
│       ├── index.html        # Stats dashboard
│       ├── admin.html        # Admin import panel
│       ├── knowledge.html    # Knowledge base management panel
│       └── docs/index.html   # API docs page
```

## Architecture & Data Flow

```
LINE Group Message → LINE Messaging API
    → POST /functions/v1/line-webhook (HMAC-SHA256 verified)
        → Check group whitelist (allowed_groups table)
        → Daily summary: on first text msg after UTC+8 10:00, generate yesterday's summary via AI
        → If "@小清新 X月發話": query stats, reply with ranking
        → If "@小清新 <other>": fetch knowledge_base → inject into system prompt → call OpenAI API (or fallback to hardcoded responses)
        → Count text messages: increment_message_count_dedup RPC (dedup by message_id)
        → Store text messages: store_group_message RPC (for daily summary, retained 60 days)
        → Cache group/user names lazily

Frontend Dashboard → GET /functions/v1/get-stats
    → action=groups | action=months | default (stats by group+month)

Admin Panel → POST /functions/v1/admin-import
    → X-Admin-Key header auth
    → Parse "Name: count" format, lookup user_id by name, upsert

Knowledge Admin → GET/POST/PUT/DELETE /functions/v1/admin-knowledge
    → X-Admin-Key header auth
    → CRUD operations on knowledge_base table
```

## Database Schema

### Tables
- **message_counts** — `(group_id, user_id, year_month)` unique, tracks count per user per month
- **group_names** — Cache of LINE group names (14-day expiry)
- **user_names** — Cache of LINE user display names (7-day expiry)
- **allowed_groups** — Whitelist of group IDs that can use the bot
- **processed_events** — Dedup table for LINE message IDs (auto-cleanup after 24h)
- **group_messages** — Stores text messages for daily summary (retained 60 days)
- **daily_summary_state** — Tracks daily summary generation state per group (retained 90 days)
- **knowledge_base** — Knowledge entries injected into AI system prompt for context-aware responses (context stuffing)

### Key RPC Functions (called via `supabase.rpc()`)
- `increment_message_count_dedup(p_group_id, p_user_id, p_year_month, p_message_id)` — Atomic dedup + upsert +1
- `increment_message_count(p_group_id, p_user_id, p_year_month)` — Legacy upsert +1 (still exists)
- `get_group_name(p_group_id)` / `get_user_name(p_user_id)` — Return cached name or NULL if expired
- `upsert_group_name(p_group_id, p_group_name)` / `upsert_user_name(p_user_id, p_user_name)`
- `is_group_allowed(p_group_id)` — Boolean whitelist check
- `store_group_message(p_group_id, p_user_id, p_message_text, p_sent_at)` — Store message + probabilistic cleanup
- `try_claim_daily_summary(p_group_id, p_summary_date)` — Atomic claim to prevent duplicate summaries
- `cleanup_processed_events(p_older_than_hours)` — Manual dedup table cleanup utility

### Security
- RLS enabled on **all** tables; only `service_role` has access
- All DB functions have explicit `search_path = public` set
- Edge functions use `SUPABASE_SERVICE_ROLE_KEY` (not anon key)

## Environment Variables

| Variable | Used in | Description |
|---|---|---|
| `LINE_CHANNEL_SECRET` | line-webhook | HMAC-SHA256 signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | line-webhook | Reply messages & fetch profiles |
| `LINE_BOT_NAME` | line-webhook | Bot mention pattern (default: "Bot") |
| `OPENAI_API_KEY` | line-webhook | AI responses & daily summary (optional, fallback to hardcoded) |
| `ADMIN_SECRET_KEY` | admin-import, admin-knowledge | Admin API authentication |
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
- Timezone: Asia/Tokyo (UTC+9) for year_month calculation; UTC+8 for daily summary trigger hour

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
- Model: `gpt-5-nano`, temperature: 0.9, max_tokens: 230

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
- `admin-knowledge` has JWT verification **disabled** but requires `X-Admin-Key` header
- Stats requests (`@botname X月發話`) **are** counted as messages (same as all text messages)
- Only **text** messages are counted (stickers, images, etc. are ignored)
- Message counting uses **dedup** (`increment_message_count_dedup`) to handle LINE webhook retries
- Text messages are stored in `group_messages` for daily summary (first 500 chars per message)
- Daily summary triggers on the **first text message after UTC+8 10:00** each day, using atomic claim to prevent duplicates; requires at least 50 messages from yesterday
- The `_shared/` modules exist but are currently **not imported** by the functions — types and CORS are defined inline in each function
- Knowledge base uses **context stuffing**: all enabled entries are fetched and injected into the AI system prompt on each bot mention; max 3000 chars, trimmed from end by sort_order
- Frontend language: Traditional Chinese (zh-TW)
