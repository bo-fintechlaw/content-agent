# Senior dev review rubric

| Dimension | Blocker if… |
|-----------|-------------|
| Security | Secrets in code, auth bypass, missing HMAC/token checks on production routes |
| Contracts | agent-core pin drift, task route mismatch, newsletter/Slack action id drift |
| Migrations | Non-idempotent SQL, missing RLS, destructive DDL without guard |
| Tests | Behavior change with zero test updates on touched modules |
| Ceilings | Suggested auto-merge or autonomy ceiling flips |

Nits are optional polish. Request changes only when a blocker or major exists.
