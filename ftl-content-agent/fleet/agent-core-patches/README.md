# agent-core patches — newsletter action kinds

Apply these changes to the existing `ftl/agent-core` repo.

## 1. SQL migration — `agent_actions_kind_check`

```sql
ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_kind_check;

ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_kind_check CHECK (
  kind IN (
    -- existing kinds ...
    'newsletter_issue_draft',
    'newsletter_social_post'
  )
);

INSERT INTO agent_autonomy_rules (kind, level, gate_channel_id)
VALUES
  ('newsletter_issue_draft', 'shadow', 'C0BB9U7AN0Y'),
  ('newsletter_social_post', 'shadow', 'C0BB9U7AN0Y')
ON CONFLICT (kind) DO NOTHING;
```

## 2. Ceiling constants

Add to `CEILING_APPROVE` / `NEVER_AUTO`:

```ts
export const CEILING_APPROVE = new Set([
  // ...
  'newsletter_issue_draft',
  'newsletter_social_post',
]);

export const NEVER_AUTO = new Set([
  // ...
  'newsletter_issue_draft',
  'newsletter_social_post',
]);
```

## 3. CI test

Seeded `auto` for `newsletter_issue_draft` must resolve to `approve`.

## 4. Slack card

`buildNewsletterIssueDraftCard({ web_preview_url, email_test_id, carousel_urls })`
- Channel: `C0BB9U7AN0Y`
- Buttons: Approve / Edit / Discard
- On Approve: `POST {CONTENT_AGENT_BASE_URL}/api/tasks/publish-newsletter-issue`
- On Edit: write `agent_corrections`, re-trigger CMO assemble
