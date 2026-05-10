# FinTech Law Content Agent

Autonomous content pipeline for FinTech Law LLC. Scans legal/fintech RSS feeds, ranks topics, drafts and judges blog content with Claude, routes through Slack for approval, publishes to Sanity, posts to LinkedIn + X.

**Source of truth:** [`CLAUDE.md`](../CLAUDE.md) — architecture, status flow, env vars, debugging.

## Planning docs

- [`FTL_Prompt_Architecture_Proposal_v1.md`](./FTL_Prompt_Architecture_Proposal_v1.md) — phased prompt-engineering improvements (drafter split, voice critic, prompt caching, extended thinking).
- [`FTL_Pipeline_Roadmap_v1.md`](./FTL_Pipeline_Roadmap_v1.md) — cadence, Slack `/suggest` command, biweekly newsletter module.
- [`FTL_Editorial_Intelligence_v1.md`](./FTL_Editorial_Intelligence_v1.md) — source diversity, primary-regulator bias, prior-posts cross-reference.

## Quick start

```bash
cp .env.example .env       # fill every variable; startup validation is fail-fast
npm install
npm start                  # listens on PORT (default 3001)
```

Apply SQL migrations under `src/db/migrations/` in order before first run. Either via the Supabase SQL editor or, if the CLI is linked to the project, via:

```bash
npx --yes supabase db query --linked --file src/db/migrations/<file>.sql
```

## Manual triggers (server running)

| Endpoint | What it does |
|---|---|
| `GET /api/scan-now` | Run RSS scanner |
| `GET /api/rank-now` | Score pending topics |
| `GET /api/draft-now` | Draft the top ranked topic |
| `GET /api/judge-now?draftId=…` | Judge a specific draft (or oldest unjudged if omitted) |
| `GET /api/start-production?topicId=…` | On-demand draft + judge for a single topic |
| `GET /api/orchestrate-now` | Run publish + social cycle |
| `POST /api/analytics/import` | Ingest a CSV (GSC chart/pages/queries or LinkedIn posts) into `content_analytics` |
| `GET /api/analytics/hints` | Preview the performance-feedback block injected into the next ranker run |
| `GET /api/cron-health` | Cron-run history grouped by name |
| `GET /api/health` | Server + DB health |

## LinkedIn OAuth (one-time, to obtain `LINKEDIN_ACCESS_TOKEN`)

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/), add the **Authorized redirect URL** matching `LINKEDIN_REDIRECT_URI` in `.env` (scheme, host, port, path must match exactly).
2. Start the app, open `http://localhost:3001/oauth/linkedin/start`, approve. LinkedIn redirects to `/callback/linkedin?code=…`.
3. Exchange the code:

```bash
npm run linkedin:exchange -- "PASTE_AUTHORIZATION_CODE_HERE"
```

## Analytics ingestion

The ranker reads performance feedback (top LinkedIn posts, GSC near-miss queries, CTR-gap pages) from `content_analytics` on every run. CSVs are imported via:

```bash
# Bulk-import a Google Search Console export folder (auto-detects Chart/Pages/Queries CSVs)
npm run analytics:import -- gsc-folder /path/to/gsc-export

# Or single file
npm run analytics:import -- gsc_chart      <file.csv>
npm run analytics:import -- gsc_pages      <file.csv> 2026-02-07 2026-05-08
npm run analytics:import -- gsc_queries    <file.csv> 2026-02-07 2026-05-08
npm run analytics:import -- linkedin_posts <file.csv> 2026-02-07 2026-05-08
```

Imports are idempotent (upsert on a deterministic `idem_key`). `GET /api/analytics/hints` returns the formatted block the ranker will see on its next tick.

## Tests

```bash
npm test                   # Jest with --experimental-vm-modules
```

Suites cover Zod schemas (ranker/drafter/judge outputs), pipeline integration (happy path + revision loop + manual bypass), Markdown→Portable Text, circuit breaker, and TTL cache.
