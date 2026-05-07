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

Apply SQL migrations under `src/db/migrations/` in order, in Supabase, before first run.

## Manual triggers (server running)

| Endpoint | What it does |
|---|---|
| `GET /api/scan-now` | Run RSS scanner |
| `GET /api/rank-now` | Score pending topics |
| `GET /api/draft-now` | Draft the top ranked topic |
| `GET /api/judge-now?draftId=…` | Judge a specific draft (or oldest unjudged if omitted) |
| `GET /api/start-production?topicId=…` | On-demand draft + judge for a single topic |
| `GET /api/orchestrate-now` | Run publish + social cycle |
| `GET /api/health` | Server + DB health |

## LinkedIn OAuth (one-time, to obtain `LINKEDIN_ACCESS_TOKEN`)

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/), add the **Authorized redirect URL** matching `LINKEDIN_REDIRECT_URI` in `.env` (scheme, host, port, path must match exactly).
2. Start the app, open `http://localhost:3001/oauth/linkedin/start`, approve. LinkedIn redirects to `/callback/linkedin?code=…`.
3. Exchange the code:

```bash
npm run linkedin:exchange -- "PASTE_AUTHORIZATION_CODE_HERE"
```

## Tests

```bash
npm test                   # Jest with --experimental-vm-modules
```

Suites cover Zod schemas (ranker/drafter/judge outputs), pipeline integration (happy path + revision loop + manual bypass), Markdown→Portable Text, circuit breaker, and TTL cache.
