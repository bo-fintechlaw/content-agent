#!/usr/bin/env bash
# Apply branch protection to main (Bo admin PAT required).
# Usage: GH_TOKEN=<admin-pat> ./scripts/apply-branch-protection.sh [repo...]
#
# Solo maintainer (Bo): 0 required approving reviews; CODEOWNERS auto-request only.
# Required status checks: CI + Senior Dev Review (see .github/workflows/).
# See docs/architect/AGENT-SECURITY-SETUP-BRIEF.md Step 2.
set -euo pipefail

if [[ $# -gt 0 ]]; then
  REPOS=("$@")
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  mapfile -t REPOS < <(
    node --input-type=module -e "
      import { fleetFullRepos } from '${SCRIPT_DIR}/fleet-repos-lib.mjs';
      fleetFullRepos().forEach((r) => console.log(r));
    "
  )
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN required (admin:repo_hook or repo admin)" >&2
  exit 1
fi

# 0 = solo Bo; set REQUIRED_APPROVALS=1 when a second human reviewer exists.
REQUIRED_APPROVALS="${REQUIRED_APPROVALS:-0}"
REQUIRE_CODEOWNERS="${REQUIRE_CODEOWNERS:-false}"
# strict=false avoids rebase churn on fleet incidental merges; CI validates head SHA.
STRICT_UP_TO_DATE="${STRICT_UP_TO_DATE:-false}"

for REPO in "${REPOS[@]}"; do
  echo "Applying branch protection: $REPO main (approvals=${REQUIRED_APPROVALS}, strict=${STRICT_UP_TO_DATE})"
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/${REPO}/branches/main/protection" \
    -f required_status_checks="{\"strict\":${STRICT_UP_TO_DATE},\"checks\":[{\"context\":\"CI\",\"app_id\":null},{\"context\":\"Senior Dev Review\",\"app_id\":null}]}" \
    -F enforce_admins=false \
    -f required_pull_request_reviews="{\"required_approving_review_count\":${REQUIRED_APPROVALS},\"dismiss_stale_reviews\":true,\"require_code_owner_reviews\":${REQUIRE_CODEOWNERS}}" \
    -F restrictions=null \
    -F required_linear_history=false \
    -F allow_force_pushes=false \
    -F allow_deletions=false \
    -F block_creations=true \
    -F required_conversation_resolution=true
  echo "OK $REPO — verify: https://github.com/${REPO}/settings/branches"
done

echo "Done. Bypass policy: Bo-only emergency (docs/architect/branch-protection-policy.md)"
