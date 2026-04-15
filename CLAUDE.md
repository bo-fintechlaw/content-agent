# CLAUDE.md — FTL Content Agent

## Project Overview

Autonomous content pipeline for **FinTech Law LLC**. Scans legal/fintech RSS feeds, uses Claude to rank, draft, and judge content, routes through Slack for human approval, publishes to Sanity CMS, and posts to LinkedIn + X.

**Owner:** Bo Howell  
**Stack:** Node.js 20+ (ESM), Express, Supabase (PostgreSQL), Anthropic SDK, Slack Bolt, Sanity CMS  
**Deploy:** Railway via Dockerfile (health check on `GET /health`)

---

## Architecture — 7-Stage Pipeline

```
RSS Feeds → [Scanner] → [Ranker] → [Drafter] ⇄ [Judge] → [Slack Approval] → [Publisher] → [Social Poster]
              stage 1     stage 2     stage 3     stage 4      stage 5          stage 6       stage 7
```

**Status flow:** `pending → ranked → drafting → judging → review → approved → published`

| Stage | File | Trigger | What it does |
|-------|------|---------|-------------|
| Scanner | `src/pipeline/scanner.js` | Cron 6 AM ET / `GET /api/scan-now` | Fetches 20+ RSS feeds, deduplicates, inserts `content_topics` |
| Ranker | `src/pipeline/ranker.js` | Every 15 min / `GET /api/rank-now` | Claude scores topics 0-10, top 3 above 7.0 advance |
| Drafter | `src/pipeline/drafter.js` | Every 15 min / `GET /api/draft-now` | Claude generates blog + social content as structured JSON |
| Judge | `src/pipeline/judge.js` | Every 15 min / `GET /api/judge-now` | Claude evaluates drafts; PASS/REVISE/REJECT. Max 1 revision loop |
| Slack | `src/integrations/slack.js` | Judge PASS | Sends preview + action buttons (Approve/Request Changes/Reject) |
| Publisher | `src/pipeline/publisher.js` | Slack approve / orchestrator | Converts to Portable Text, publishes to Sanity, triggers Netlify rebuild |
| Social | `src/pipeline/social-poster.js` | After publish | Posts to LinkedIn (OAuth 2.0) and X (OAuth 1.0a) |

**Orchestrator** (`src/pipeline/orchestrator.js`): Coordinates publish + social stages. Has a single-threaded guard to prevent overlapping runs.

---

## Directory Structure

```
src/
  config/        # env.js (validation), sources.js (RSS feeds), seo-keywords.js
  db/            # supabase.js client, migrations/*.sql (001-004)
  integrations/  # anthropic.js, sanity.js, slack.js, linkedin.js, x.js, image-generator.js
  mcp/           # Notion MCP client (TypeScript) — mcpManager.ts, clients/notionMcp.ts
  pipeline/      # scanner, ranker, drafter, judge, publisher, social-poster, orchestrator
  prompts/       # System prompts: ranker-system.js, drafter-system.js, judge-system.js
  routes/        # api.js (REST endpoints), webhooks.js (Slack interactions), linkedin-oauth.js
  tools/         # databases.ts, search.ts (Notion tools)
  utils/         # logger.js, circuit-breaker.js, cache.ts, portable-text.js
  __tests__/     # Jest tests (*.test.ts)
  index.js       # Entry point: Express server + cron scheduling + MCP init
```

---

## Database (Supabase PostgreSQL)

Four tables — understand these before debugging:

| Table | Key columns | Purpose |
|-------|------------|---------|
| `content_topics` | id (UUID), title, source_url, category, relevance_score, status, suggested_by | RSS items + manual suggestions |
| `content_drafts` | id (UUID), topic_id (FK), blog_body (JSONB array), judge_scores (JSONB), judge_pass, revision_count, sanity_document_id | Generated content + judge results |
| `content_config` | key (TEXT PK), value (JSONB) | Runtime config: seo_keywords, rss_feeds, schedule |
| `content_analytics` | draft_id (FK), platform, impressions, engagements | Post-publish metrics |

**Important:** `blog_body` is a JSONB array of `{title, body}` section objects, NOT a flat text field. `judge_scores` is JSONB with keys: accuracy, engagement, seo, voice, structure.

---

## Commands

```bash
npm run dev          # Start with nodemon (hot reload)
npm start            # Production: node src/index.js
npm run build        # Compile TypeScript (mcp/, tools/) to dist/
npm test             # Jest with --experimental-vm-modules
```

**Manual triggers (while server is running):**
- `GET /api/scan-now` — Run RSS scanner
- `GET /api/rank-now` — Run ranker
- `GET /api/draft-now` — Run drafter
- `GET /api/judge-now` — Run judge
- `GET /api/orchestrate-now` — Run full publish + social cycle
- `GET /api/health` — Server + database health check

---

## Code Patterns to Follow

### Logging (proof-of-life)
Every pipeline function and integration uses structured logging:
```js
import { logger } from '../utils/logger.js';
logger.start('functionName', { key: 'value' });
logger.success('functionName', { result });
logger.fail('functionName', error, { context });
```
**Always** add start/success/fail logging when writing new functions.

### Circuit Breaker
External API calls are wrapped in circuit breakers (max 3 failures, 60s reset):
```js
import { CircuitBreaker } from '../utils/circuit-breaker.js';
const breaker = new CircuitBreaker('serviceName', { maxFailures: 3, resetTimeout: 60000 });
const result = await breaker.call(() => externalApi(), fallbackValue);
```

### Claude API calls
Use the wrapper in `src/integrations/anthropic.js`:
- `prompt(systemPrompt, userMessage)` — returns text
- `promptJson(systemPrompt, userMessage)` — returns parsed JSON (handles markdown fences, trailing commas)

### Supabase queries
Always check for errors:
```js
const { data, error } = await supabase.from('table').select('*');
if (error) throw new Error(`Query failed: ${error.message}`);
```

### ESM imports
This project uses ES modules. Always use `.js` extensions in imports, even for TypeScript files that compile to JS.

---

## Environment

Required env vars are validated at startup in `src/config/env.js` — the server exits if any are missing. See `.env.example` for the full list. Key groups:
- **Anthropic:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default: claude-sonnet-4-6)
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- **Sanity:** `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_TOKEN`, `SANITY_SCHEMA_ID`
- **Slack:** `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`
- **LinkedIn/X:** OAuth credentials (see .env.example)
- **Optional:** `XAI_API_KEY` (image gen), `NETLIFY_BUILD_HOOK` (site rebuild), `NOTION_*` (MCP)

---

## Git & Deployment Workflow

- **Branch:** Work on feature branches, PR to `main`
- **Deploy:** Push to `main` triggers Railway auto-deploy via Dockerfile
- **Before pushing:** Always run `git log --oneline origin/main..HEAD` to confirm exactly which commits will be pushed. Never push unintended commits.
- **Commits:** Confirm exact files to stage before committing. Prefer specific `git add <file>` over `git add .`

---

## Testing & Validation

- **Test framework:** Jest with ts-jest for TypeScript files
- **Test location:** `src/__tests__/`
- **Run tests:** `npm test` (on Windows: `set NODE_OPTIONS=--experimental-vm-modules && npx jest`)
- **Test suites:**
  - `schemas/pipeline.test.ts` — Zod validation for ranker/drafter/judge outputs (27 tests)
  - `pipeline/integration.test.ts` — Full happy-path + revision loop + manual bypass (4 tests)
  - `utils/portable-text.test.ts` — Markdown → Portable Text conversion (20 tests)
  - `utils/circuit-breaker.test.ts` — Circuit breaker behavior (8 tests)
  - `utils/cache.test.ts` — TTL cache (9 tests)
- **Validation schemas:** `src/schemas/pipeline.js` — Zod schemas validate all Claude API responses before DB insertion. Imported by ranker, drafter, and judge.
- **JSON validation:** When editing JSON config or JSONB structures, validate with:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('path/to/file.json', 'utf8'))"
  ```

---

## Key Integration Details

| Service | Auth method | Key gotchas |
|---------|------------|-------------|
| Anthropic (Claude) | API key | JSON response parsing handles markdown fences + trailing commas |
| Sanity CMS | API token | Uses API version `2025-02-19`. Portable Text conversion in `utils/portable-text.js` |
| Slack | Bot token + signing secret | Webhook verification via HMAC. Interactions come to `POST /slack/interactions` |
| LinkedIn | OAuth 2.0 | Token exchange via `npm run linkedin:exchange`. UGC API v2 |
| X (Twitter) | OAuth 1.0a (HMAC-SHA1) | Supports single tweets + threads |
| xAI (Grok) | API key | Optional image generation for blog featured images |
| Notion | MCP (HTTP transport) or direct API | MCP at `NOTION_MCP_URL`, TypeScript client in `src/mcp/` |

---

## Debugging Checklist

1. **Check database schema first** — read `src/db/migrations/` to understand actual column types before assuming data shapes
2. **Check env validation** — `src/config/env.js` will tell you what's required vs optional
3. **Check circuit breaker state** — if an external service is failing, the breaker may be open (60s cooldown)
4. **Read the relevant prompt** — drafter/judge/ranker behavior is defined in `src/prompts/`
5. **Check status flow** — topics progress through specific statuses; a stuck item means a stage failed silently
6. **Health endpoint** — `GET /api/health` checks DB connectivity and returns uptime
