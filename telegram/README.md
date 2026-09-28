# Telegram check-in backend and Mini App

This is a separate Node.js API and Telegram Mini App. The static E.Hook dashboard at the repository root remains independent and is not changed by this project.

## Requirements

- Node.js 22.9 or newer
- npm
- A Supabase project
- The Telegram bot token from BotFather (server-side only)

## Configure local environment

Copy `.env.example` to `.env`, then set the following values locally:

- `SUPABASE_URL`: **Supabase Dashboard → Project Settings → API → Project URL**.
- `SUPABASE_SERVICE_ROLE_KEY`: server-side service role key from **Project Settings → API → Project API keys**. It bypasses row-level security; never expose it to a browser or commit it.
- `TELEGRAM_BOT_TOKEN`: the BotFather token used by the server to verify signed Mini App `initData`. Never put it in Mini App HTML, client JavaScript, or a public deployment setting.
- `HOST` and `PORT` (optional): defaults are `127.0.0.1` and `8787`.
- `NODE_ENV=development`, `TELEGRAM_DEV_AUTH=true`, and `TELEGRAM_DEV_USER_ID`: optional local browser testing only. The dev identity is configured on the server, not supplied as a user ID by the browser. `HOST` must be `127.0.0.1`, `localhost`, or `::1`. The dev mode is ignored outside `NODE_ENV=development`; production requires `TELEGRAM_BOT_TOKEN` and real Telegram `initData`.

The checked-in `.env.example` contains placeholders only. Do not copy the example values into a production environment unchanged. Never commit `.env`.

## Apply the database migrations

In Supabase Dashboard → SQL Editor, apply these migrations in order:

1. `supabase/migrations/20260928170000_create_daily_check_ins.sql`
2. `supabase/migrations/20260928180000_scope_check_ins_to_telegram_users.sql`

The second migration adds `telegram_user_id BIGINT` and makes the unique key `(telegram_user_id, date)`. It intentionally does not infer an owner for any older Stage 3 rows. Those rows remain unassigned and cannot be returned by authenticated user-scoped queries. The migration permits those old rows to remain while requiring IDs on new or updated rows. If historical rows need to be retained in a user's account, review and backfill them explicitly in Supabase before applying a later constraint-tightening migration.

## Telegram authentication

Inside Telegram, the Mini App sends the raw `Telegram.WebApp.initData` value in the `X-Telegram-Init-Data` request header. The backend validates the HMAC-SHA-256 signature using the server-only bot token, checks the signed `auth_date` (maximum age 1 hour, with 30 seconds of future clock skew), and takes the Telegram account ID from the signed `user` value. It does not trust a browser-supplied account ID. Reopen the Mini App if its authentication data has expired.

For local browser use, the Mini App sends `X-Telegram-Dev-Auth: true` only on a loopback origin when no usable Telegram `initData` is available. The backend accepts this only with all local development gates configured. It uses the server's `TELEGRAM_DEV_USER_ID`; any client-supplied ID is ignored. Vercel function handlers always pass `developmentAuth: null`, and the environment resolver also disables it when Vercel runtime markers are present. Never enable this mode in a remotely hosted environment.

## Run locally

```sh
cp .env.example .env
# Set the local Supabase values and the BotFather token in .env.
npm test
npm start
```

The form is served at `http://127.0.0.1:8787/`. To test in a regular browser, use the explicit local development settings above. A production request without valid Telegram authentication is rejected.

## Vercel deployment preparation

The project is prepared for a separate Vercel project with **Root Directory** set to `telegram/`. The checked-in `vercel.json` selects `web/` as the static output directory, so `web/index.html` is served from `/`. Vercel discovers Node.js Functions in `api/`; `api/check-ins.js` handles `/api/check-ins` and `api/health.js` handles `/api/health`. A rewrite also preserves `/health`. The Mini App uses relative `/api/check-ins` requests, so it stays same-origin when served from the Vercel root.

Configure these variables in Vercel's Production environment, and in Preview only if preview deployments should use the backend:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`

Treat the service role key and bot token as sensitive server-only values. Vercel Functions do not need `HOST`, `PORT`, `TELEGRAM_DEV_AUTH`, or `TELEGRAM_DEV_USER_ID`. The Vercel handlers require all three server variables before serving requests, and do not enable the local synthetic identity in any deployment. For Preview, use isolated/staging Supabase credentials where possible; avoid sharing production data unnecessarily.

`npm start` remains the local long-running Node HTTP server. Vercel invokes request handlers and does not call `server.listen()`. Vercel project creation, linking, and deployment have not been performed. The Vercel Production Branch must be reviewed before enabling Git deployments so a push to the repository's existing dashboard branch does not unexpectedly publish the Telegram app.

## API

- `POST /api/check-ins` requires valid Telegram authentication and a valid check-in body. It derives `telegram_user_id` from verified auth and inserts into Supabase.
- `GET /api/check-ins?date=YYYY-MM-DD` requires the same authentication and filters by both date and authenticated Telegram account. A record owned by another account appears as `404`.
- `409 CHECK_IN_EXISTS` means that account already has a check-in for that date.
- Missing, malformed, invalid-signature, or expired auth is rejected with `401`. Missing server bot-token configuration for a supplied `initData` returns a generic configuration error with `503`.
- `GET /health` reports API health and does not return account data.

This stage does not register a BotFather webhook, connect Telegram commands, deploy the API, or schedule the 9 PM reminder. Vercel Cron schedules use UTC; the future reminder implementation must account for UK daylight-saving changes and secure its invocation.

## Tests and live Supabase check

`npm test` runs the database-independent API, validation, and Telegram-auth tests with synthetic test credentials only. A live Supabase integration test is opt-in and requires the Stage 4 migration to have been applied, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the local environment:

```sh
RUN_SUPABASE_INTEGRATION=1 npm test
```

The live test uses a reserved future date and a synthetic Telegram account ID, checks insert/duplicate/retrieval, then deletes only that test account's row for the selected date. Do not run it concurrently with another copy using the same test account/date.
