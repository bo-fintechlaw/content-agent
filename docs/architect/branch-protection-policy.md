# Branch protection policy (parallel-build §9 gate #5)

**Applies to:** `main` on all C-suite agent repos  
**Owner:** Architect-Cursor (policy) · Bo (GitHub admin enforcement)

---

## Required rules on `main`

| Rule | Setting |
|---|---|
| Require pull request before merge | **On** |
| Required approving reviews | **0** (solo Bo; set to 1 when second human reviewer exists) |
| Require status checks | **On** — required checks: `CI` + `Senior Dev Review` |
| Require branches up to date | **Off** (loose; `strict=false` — avoids fleet rebase churn; CI validates head SHA) |
| Block force pushes | **On** |
| Block direct commits | **On** (`block_creations=true`; Bo may emergency bypass) |
| Require conversation resolution | **On** (recommended) |
| Require review from Code Owners | **Off** until second reviewer (CODEOWNERS still documents ownership) |

Optional **CODEOWNERS** paths (auto-request review):

- `migrations/**`
- `vendor/ftl-agent-core/**`
- `src/constants/ceilings.ts`

---

## Repos

| Repo | Protection settings URL | CI workflow |
|---|---|---|
| `bo-fintechlaw/ftl-cto-agent` | https://github.com/bo-fintechlaw/ftl-cto-agent/settings/branches | `.github/workflows/ci.yml` |
| `bo-fintechlaw/ftl-cfo-agent` | https://github.com/bo-fintechlaw/ftl-cfo-agent/settings/branches | Mirror `ci.yml` |
| `bo-fintechlaw/fintechlaw-cos-agent` | https://github.com/bo-fintechlaw/fintechlaw-cos-agent/settings/branches | Mirror `ci.yml` |

Apply via GitHub UI or `scripts/apply-branch-protection.sh` (requires admin `GH_TOKEN`).

---

## Bypass policy (Bo-only emergency)

| Condition | Allowed bypass? | Requirements |
|---|---|---|
| Production outage hotfix | Yes — **Bo only** | Post-incident note in `#cto-agent` or Bo DM; retro PR within 24h |
| Architect agent-core release | Yes — **Architect-Cursor** on `ftl-agent-core` only | Tagged release + vendor PRs follow |
| Cursor Cloud agent token | **No bypass** | Cannot enable branch protection (integration lacks admin) |
| Force-push to `main` | **Never** except repo deletion recovery |

All bypass events must be logged:

1. GitHub audit log (Settings → Audit log)
2. Comment on retro PR linking incident
3. Optional: `docs/decisions/` ADR for policy exceptions

---

## CI required check

Workflow **`CI`** runs on every PR and push to `main`:

```yaml
npm ci
npm run typecheck
npm test
```

Deploy workflow (`Deploy to Railway`) is **not** a merge gate — deploy runs after merge to `main`.

---

## Senior Dev Review required check

Workflow **Claude Senior Dev Review** (job name **`Senior Dev Review`**) runs on every non-draft PR:

- Requires `ANTHROPIC_API_KEY` in repo Actions secrets (job fails if missing — no rubber-stamp skip)
- Claude submits `gh pr review --approve` with `## Senior Dev review` body (T2.5-g gate)
- Job fails when `review-report.json` verdict is not `approve`

Apply with updated `scripts/apply-branch-protection.sh` or patch required checks:

```bash
GH_TOKEN=<admin-pat> ./scripts/apply-branch-protection.sh
# Or patch checks only:
for repo in ftl-cto-agent ftl-cfo-agent fintechlaw-cos-agent; do
  gh api -X PATCH "repos/bo-fintechlaw/$repo/branches/main/protection/required_status_checks" \
    -f strict=false \
    -f 'checks[][context]=CI' \
    -f 'checks[][context]=Senior Dev Review'
done
```

**Pre-requisite:** Run the workflow once on a test PR per repo so the check appears in the branch protection picker (GitHub requires a successful run within 7 days).

---

## Rollout checklist (Bo)

- [ ] Merge this PR (adds `ci.yml` + CODEOWNERS)
- [ ] Run `scripts/apply-branch-protection.sh` with admin PAT **or** configure UI per repo
- [ ] Mirror `.github/` files to CFO + COS repos
- [ ] Confirm required checks `CI` + `Senior Dev Review` appear green on a test PR per repo
- [ ] Confirm `ANTHROPIC_API_KEY` set in Actions secrets on all three repos
- [ ] Screenshot or link branch protection page in handoff doc

*Gate #5 exit: protection live on all three repos with CI + Senior Dev Review required.*
