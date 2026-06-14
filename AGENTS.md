# AGENTS.md

The application lives in the [`ftl-content-agent/`](./ftl-content-agent) subdirectory. Run all `npm` commands from there. See [`CLAUDE.md`](./CLAUDE.md) for architecture and [`ftl-content-agent/README.md`](./ftl-content-agent/README.md) for standard commands.

## Cursor Cloud specific instructions

The product is a single headless Node.js (ESM) service in `ftl-content-agent/` — an Express API + `node-cron` content pipeline (RSS → rank → draft → judge → Slack → Sanity → social). It has no UI of its own; verify it with HTTP calls and logs. Standard scripts live in `ftl-content-agent/package.json` (`dev`, `start`, `build`, `test`).

- **`npm run build` is mandatory before running the app.** `src/index.js` statically imports the compiled `../dist/mcp/mcpManager.js`; without `dist/` the app crashes at load with `ERR_MODULE_NOT_FOUND`. The startup update script runs `npm install` + `npm run build`. The TypeScript only lives under `src/mcp/` and `src/tools/`.
- **Hot-reload caveat:** `npm run dev` (nodemon) watches `.js`/`.json` only and does **not** recompile TypeScript. If you edit any `.ts` under `src/mcp` or `src/tools`, re-run `npm run build` for changes to take effect.
- **No lint config exists.** The type-check/lint gate is `npm run build` (`tsc` strict, `noEmitOnError`). `npm test` (Jest, 11 suites / 144 tests) needs no secrets or DB.
- **Startup is fail-fast** on 12 required env vars (see `src/config/env.js`); the process exits if any are empty. A `.env` is required (`cp .env.example .env`). For local dev you can use a real Supabase plus *placeholder* values for `ANTHROPIC_API_KEY`, `SANITY_*`, `SLACK_*`, and `LINKEDIN_CLIENT_ID/SECRET` — those services are only contacted at their pipeline stage, not at boot. The MCP "not available" warnings on boot are expected and non-fatal.
- **Stage credential needs:** the scanner (`GET /api/scan-now`, RSS → DB) needs only Supabase. Ranking/drafting/judging need a real `ANTHROPIC_API_KEY`; publish needs Sanity; approval/reports need Slack; social posting needs LinkedIn/X. A real RSS-scan hello-world works with Supabase alone.
- **Local Supabase (needs Docker, not in the update script):** `npx supabase init` then `npx supabase start`, apply `src/db/migrations/0*.sql` in order (via `psql` in the `supabase_db_*` container), then point `.env` at `SUPABASE_URL=http://127.0.0.1:54321` with the legacy `SERVICE_ROLE_KEY` (JWT) from `npx supabase status -o env` as `SUPABASE_SERVICE_KEY`.
- **Gotcha — grant Supabase roles after raw-SQL migrations.** Applying the migration SQL as the `postgres` superuser does **not** grant table access to `anon`/`authenticated`/`service_role` the way hosted Supabase does, so PostgREST returns `403 permission denied` and `GET /api/health` reports `database.connected: false`. After migrating, run `GRANT ALL ON ALL TABLES/SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;` (+ matching `ALTER DEFAULT PRIVILEGES`) and `NOTIFY pgrst, 'reload schema';`.
