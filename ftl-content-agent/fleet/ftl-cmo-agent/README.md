# FTL CMO Agent

Newsletter authority-content slice. Deploy separately from content-agent.

## Env

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
NOTION_TOKEN=
NOTION_DB_CONTENT_CALENDAR=
CONTENT_AGENT_BASE_URL=https://your-content-agent.up.railway.app
NEWSLETTER_TASK_SECRET=
SLACK_CMO_BO_CHANNEL_ID=C0BB9U7AN0Y
```

## Run

```bash
npm install
npm run assemble -- --segment financial_services
```

## Flow

1. Read due segment from Notion editorial calendar
2. Select 2–3 posts from `published_posts_index`
3. LLM assembles Issue JSON (Bo voice)
4. `POST /api/newsletter/lint` on content-agent
5. `POST /api/tasks/render-newsletter-issue`
6. Write `newsletter_issue_draft` agent_action (via agent-core when wired)

Copy this directory to `bo-fintechlaw/ftl-cmo-agent` and push.
