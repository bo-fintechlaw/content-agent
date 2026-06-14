# FTL Content Agent — Task Interface

Agent ID: `content`

## Task kinds

### `render_newsletter_issue`

**Caller:** CMO agent (`delegate_to_agent`)

**HTTP:** `POST /api/tasks/render-newsletter-issue`

**Headers:** `X-Newsletter-Task-Token: <NEWSLETTER_TASK_SECRET>` (when configured)

**Input:**

```json
{
  "task_id": "uuid",
  "issue_json": { }
}
```

`issue_json` conforms to `src/schemas/newsletter.js` (`IssueJsonSchema`).

**Output (`report_back` payload):**

```json
{
  "issue_id": "uuid",
  "web_preview_url": "https://fintechlaw.ai/newsletter/<slug>",
  "email_test_id": "resend-email-id",
  "carousel_urls": ["https://fintechlaw.ai/api/newsletter/carousel/..."],
  "sanity_document_id": "drafts.newsletter-<slug>"
}
```

**Side effects:**
- Upserts `newsletter_issues` row (`status=review`)
- Creates Sanity draft `newsletter` document (when Sanity configured)
- Sends test email to `NEWSLETTER_TEST_EMAIL` (when Resend configured)

**Preconditions:**
- Compliance linter pass (422 if violations)
- All feature `blog_url` values resolve (500 if link check fails)

---

### `publish_newsletter_issue`

**Caller:** agent-core approval handler after Bo approves `newsletter_issue_draft`

**HTTP:** `POST /api/tasks/publish-newsletter-issue`

**Input:**

```json
{
  "issue_id": "uuid"
}
```

**Output:**

```json
{
  "issue_id": "uuid",
  "archive_url": "https://fintechlaw.ai/newsletter/<slug>",
  "sanity_document_id": "...",
  "resend_broadcast_id": "...",
  "linkedin_post_id": "...",
  "x_post_id": "..."
}
```

**Side effects:**
- Publishes Sanity newsletter document
- Resend broadcast to `RESEND_AUDIENCE_ID` (when configured)
- LinkedIn + X text posts linking to archive
- `newsletter_issues.status=published`

---

## Lint helper

`POST /api/newsletter/lint` — body = Issue JSON; returns `{ ok, violations }`.

Used by CMO before delegation.
