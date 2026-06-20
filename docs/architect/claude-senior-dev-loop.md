# Claude senior dev loop — fleet rollout

Architect canonical pack lives in `docs/architect/senior-dev/`. Copy into each peer repo:

```bash
cp docs/architect/senior-dev/claude-senior-dev-review.yml .github/workflows/
cp docs/architect/senior-dev/ci.yml .github/workflows/
cp -R docs/architect/senior-dev/senior-dev .github/
cp docs/architect/senior-dev/record-pr-review-learning.mjs scripts/
cp docs/architect/senior-dev/verify-agent-core-pins.mjs scripts/
```

## Peer repos

| Repo | Agent ID | Notes |
|------|----------|-------|
| `content-agent` | `content` | Monorepo app root: `ftl-content-agent/` |
| `ftl-cmo-agent` | `cmo` | Set `REPO_AGENT_ID=cmo` in CI |
| `ftl-agent-core` | — | Architect-owned; receives learnings, do not copy verify pins here |
| `fintechlegal_website` | `site` | Set `REPO_AGENT_ID=site` in CI |

## GitHub secrets (same three on every peer repo)

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Senior dev review model calls |
| `CTO_AGENT_TASK_SECRET` | Authenticates learning POSTs to CTO prod |
| `GITHUB_TOKEN` | Provided by Actions; used to comment review on PR |

## CTO prod URL (not a secret)

`CTO_AGENT_BASE_URL` is **hardcoded via script default** to the CTO production Railway service (see `scripts/record-pr-review-learning.mjs`). Workflows do not override it.

All peer repos POST learnings to the same prod pipeline via `scripts/record-pr-review-learning.mjs`.

## Workflows

### `CI` (`.github/workflows/ci.yml`)

Job name must be **`CI`**. Steps: `npm ci` → `npm run typecheck` → `npm test` → stage vendor manifest → `verify-agent-core-pins@0.2.2`.

### `Claude Senior Dev Review` (`.github/workflows/claude-senior-dev-review.yml`)

On PR open/sync/reopen:

1. `node .github/senior-dev/run-review.mjs` — independent diff review (Sonnet), posts PR comment
2. `node scripts/record-pr-review-learning.mjs` — forwards structured review to CTO prod when `CTO_AGENT_TASK_SECRET` is configured (`if: always() && secrets.CTO_AGENT_TASK_SECRET != ''`)

The Anthropic SDK is installed at the **repository root** so `run-review.mjs` can resolve `@anthropic-ai/sdk`. If the secret is missing (fork PRs), the learning step is skipped without failing the job.

## Hard rules

- Never commit under `vendor/ftl-agent-core/` (Architect only)
- Do not edit `src/constants/ceilings.ts` in agent repos
- Do not flip `github_merge` or `merge_requires_approval` ceilings
- Migrations must be idempotent
- Branch protection is Bo's post-merge step — not configured by this rollout

## Local smoke test

```bash
cd ftl-content-agent
mkdir -p vendor/ftl-agent-core
cp ../docs/architect/rollout/ftl-agent-core.package.json vendor/ftl-agent-core/package.json
REPO_AGENT_ID=content node scripts/verify-agent-core-pins.mjs
node scripts/record-pr-review-learning.mjs ../.github/senior-dev/review-output.json  # needs env vars
```

## Fleet scaffolds

Copies for local handoff live under `fleet/<peer>/.github/` and `fleet/<peer>/scripts/` in content-agent.
