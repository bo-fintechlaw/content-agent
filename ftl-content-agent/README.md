# FinTech Law Content Agent

Autonomous content pipeline (plain Node.js Express). **Source of truth:** [`FTL_Content_Agent_Architecture_Spec_v1_0.md`](./FTL_Content_Agent_Architecture_Spec_v1_0.md).

## Phase 1 — Setup

1. Copy `.env.example` to `.env` and set every variable (fail-fast validation on startup).
2. Apply SQL migrations in order under `src/db/migrations/` (`001` → `004`) in Supabase.
3. Install and run:

```bash
npm install
npm start
```

## Verification

| Check | Expected |
|--------|----------|
| `npm install` | Completes without errors |
| `npm start` | Exits with a clear missing-variable message if `.env` is incomplete; otherwise listens on `PORT` |
| `GET /health` | `{ "status": "ok", "timestamp": "<ISO8601>" }` |
| `GET /api/health` | Same `status` + `timestamp`, plus `uptimeSeconds` and `database` (503 if Supabase unreachable or migrations missing) |
| `POST /api/suggest-topic` | `501` stub |
| `GET /api/topics` | JSON list from `content_topics` (max 100) |
| `GET /api/scan-now` | Runs RSS scanner; returns `{ ok, inserted, skipped, errors, feedsProcessed }` |
| `GET /api/drafts` | `501` stub until Phase 4+ |

## Phase 2 — Source scanner

- **Feeds:** `src/config/sources.js` (`RSS_FEEDS`) — Artificial Lawyer, CoinDesk, SEC press releases by default.
- **Pipeline:** `src/pipeline/scanner.js` — `runSourceScan(supabase)` fetches each feed behind a **circuit breaker**, dedupes by `source_url`, inserts `status: 'pending'` rows.
- **Cron:** Daily **6:00 AM America/New_York** (`index.js`).
- **Manual:** `GET http://localhost:3001/api/scan-now` while the server is running.
- **Verify:** `GET /api/scan-now` then `GET /api/topics` or Supabase `content_topics`.

## Patterns

- **Logger:** `start` / `success` / `fail` from `src/utils/logger.js` (Proof of Life).
- **Circuit breaker:** `src/utils/circuit-breaker.js` — used per RSS feed in the scanner.
- **One Change Rule:** validate Phase 2 before Phase 3 (ranker).

## Phase 1 file set

`package.json`, `.env.example`, `.gitignore`, `src/config/env.js`, `src/utils/logger.js`, `src/utils/circuit-breaker.js`, `src/db/supabase.js`, `src/db/migrations/*.sql`, `src/index.js`, `src/routes/api.js`.

**Phase 2:** `src/config/sources.js`, `src/pipeline/scanner.js` — `node-cron` in `index.js` for daily scan.

## LinkedIn OAuth (get `LINKEDIN_ACCESS_TOKEN`)

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/), add an **Authorized redirect URL** that matches **`LINKEDIN_REDIRECT_URI`** in `.env` (scheme, host, port, and path must match **exactly** — `http` vs `https` matters). For local dev, `http://localhost:3001/callback/linkedin` is typical; `https://localhost` often fails unless you terminate TLS locally.
2. Start the app (`npm start`). Open **`http://localhost:3001/oauth/linkedin/start`** in your browser — it redirects to LinkedIn using your real **Client ID** and **redirect URI** from `.env` (no manual URL, no `YOUR_CLIENT_ID` placeholder). After you approve, LinkedIn sends you to `/callback/linkedin` with a `code`.
3. Exchange the code (reads `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` from `.env`):

```bash
npm run linkedin:exchange -- "PASTE_AUTHORIZATION_CODE_HERE"
```

**Optional `curl.exe` (PowerShell, one line)** — set `CODE` and fill client fields; `redirect_uri` must match step 1:

```powershell
curl.exe -X POST "https://www.linkedin.com/oauth/v2/accessToken" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=authorization_code" -d "code=CODE" -d "client_id=YOUR_CLIENT_ID" -d "client_secret=YOUR_CLIENT_SECRET" -d "redirect_uri=http://localhost:3001/callback/linkedin"
```
