# FinTech Law Content Agent — Architecture Specification v1.0

**Status:** Source of truth for the `ftl-content-agent` repository.  
**Stack:** Node.js Express on port 3001, Supabase (PostgreSQL), Claude (Anthropic), Sanity CMS, LinkedIn API v2, X API v2, Slack app (Web API + interactivity).

---

## Pipeline (stages)

1. **Scanner** — RSS / sources → `content_topics`  
2. **Ranker** — Claude scores topics → `relevance_score`, status  
3. **Drafter** — Claude produces blog + social + image prompt → `content_drafts`  
4. **Judge** — Claude evaluates draft → `judge_scores`, `judge_pass`  
5. **Slack approval** — interactive buttons → approved / rejected / edit link  
6. **Publish** — parallel: Sanity (+ Agent Actions image), LinkedIn, X  
7. **Analytics** — `content_analytics`

---

## Environment variables

See `.env.example` in this repo. Required keys are validated at startup in `src/config/env.js`.

---

## Database (section 4)

### `content_topics`

- `id` UUID PK  
- `source_url`, `source_name`, `title`, `summary`  
- `category` — `regulatory` | `ai_legal_tech` | `startup` | `crypto`  
- `relevance_score` NUMERIC(3,1)  
- `status` — `pending` | `ranked` | `drafting` | `judging` | `review` | `approved` | `published` | `rejected` | `archived`  
- `suggested_by` — default `scanner`  
- `created_at`, `updated_at` TIMESTAMPTZ  

### `content_drafts`

- `id` UUID PK, `topic_id` FK → `content_topics`  
- `blog_title`, `blog_slug`, `blog_body` JSONB  
- `blog_seo_title`, `blog_seo_description`, `blog_seo_keywords`, `blog_category`, `blog_tags`  
- `linkedin_post`, `x_post`, `x_thread` JSONB  
- `image_prompt`, `image_generated` BOOLEAN  
- `judge_scores` JSONB, `judge_pass` BOOLEAN, `judge_flags` TEXT[]  
- `revision_count` INTEGER  
- `sanity_document_id`, `linkedin_post_id`, `x_post_id` TEXT  
- `published_at`, `created_at`  

### `content_config`

- `key` TEXT PK, `value` JSONB, `updated_at`  
- Seed: `seo_keywords`, `rss_feeds`, `schedule`, `voice_examples`  

### `content_analytics`

- `id` UUID PK, `draft_id` FK, `platform` (`blog` | `linkedin` | `x`)  
- `impressions`, `engagements`, `shares`, `comments`  
- `measured_at`, `raw_data` JSONB  

---

## Critical patterns

- **Proof of Life:** `logger.start` / `logger.success` / `logger.fail` on pipeline and integration functions.  
- **Circuit breaker:** all external API calls (max 3 failures, 60s reset).  
- **Fail-fast env:** server does not start with missing required credentials.

---

## Phase roadmap

Implementation follows the **One Change Rule**: validate each phase before the next. See project `README.md` for Phase 1 scope.
