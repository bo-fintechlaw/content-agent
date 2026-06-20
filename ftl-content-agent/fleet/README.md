# Fleet workspace setup

Repos synced to workspace root for local development:

- `/workspace/ftl-agent-core` — canonical repo at `~/ftl-agent-core` (no longer vendored under `fleet/`)
- `/workspace/ftl-cmo-agent` — standalone repo at `~/ftl-cmo-agent` (https://github.com/bo-fintechlaw/ftl-cmo-agent)
- `/workspace/fintechlegal_website` — from `fleet/fintechlegal_website`

Senior-dev / CI scaffolds (copy to peer repo roots): `fleet/<peer>/.github/` + `fleet/<peer>/scripts/`.  
Full doc: [`docs/architect/claude-senior-dev-loop.md`](../../docs/architect/claude-senior-dev-loop.md) (from repo root).

Sample Zoho CSV: `data/zoho-subscribers.sample.csv`

Bo's production CSV path (local only):
`/Users/bojhowell/Downloads/ComplianceUpdatesFTL_Report (1).csv`
