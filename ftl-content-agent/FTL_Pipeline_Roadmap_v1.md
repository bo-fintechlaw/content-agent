# FTL Content Agent — Pipeline Roadmap v1

**Status:** Planning doc, not yet implemented
**Author:** Roadmap session, 2026-04-30
**Companion to:** `FTL_Prompt_Architecture_Proposal_v1.md` (prompt architecture)

This doc captures the next planning horizon for the FTL content agent: cadence, manual topic ingestion, and the newsletter module. The Phase 1 prompt architecture (verdict.js, anchored ranker, fixed prompts) shipped 2026-04-30 and is independent of this roadmap.

---

## 1. Cadence — daily, with an on-demand path

**Decision: stay daily; add manual immediate-publish.**

The 7 AM ET cron currently picks one topic per day. Going to twice-daily would:

- Dilute LinkedIn algorithm reach (B2B audiences engage best with ≤1 post/day until follower count + engagement establish baseline).
- Push more borderline 7.5-7.9 composite drafts through the judge — cadence pressure makes the system less willing to wait for a quality REVISE → re-judge cycle.
- Strain the topic queue. The ranker currently picks top 3 of fresh RSS items per Monday scan; going to 14 posts/week against a queue that produces ~10-15 ranked-eligible topics/week is cutting it close.

**Better lever: on-demand publish for opportunistic posts.** The system already has the wiring — `/api/start-production?topicId=...` runs draft+judge on a specific topic. The missing piece is a frictionless way for you to drop a topic in (see §2).

Revisit cadence after 4 weeks of daily publishing. If LinkedIn engagement plateaus and the topic queue is overflowing, twice-daily becomes worth re-evaluating.

---

## 2. Manual topic suggestions — Slack `/suggest` command

**Decision: build a Slack slash command. Skip email ingestion for now.**

Most of the manual-topic infrastructure is already in place:

- `runTopicRanking` (`ranker.js:63-77`) bypasses the ranker for `suggested_by='manual'` topics, setting `relevance_score=10.0` and `status='ranked'` immediately.
- `/api/start-production?topicId=...` runs the full draft+judge pipeline on a specific topic.
- `/api/suggest-topic` already exists (per prior work) for inserting manual topics.

What's missing is the **input UX**. Email forwarding (regulator alerts → topic) is the heaviest path; Slack is the lightest.

### Slack `/suggest` command — design

Single slash command with structured arguments. Three modes:

| Form | Behavior |
|---|---|
| `/suggest <url>` | Insert manual topic from URL metadata. Queue for next 7 AM cron. |
| `/suggest now <url>` | Insert manual topic + immediately fire `runDraftAndJudge`. Result lands in Slack within ~3 minutes. |
| `/suggest pair <url1> with <url2>` | Insert manual topic that pairs two stories (e.g., "FBI fraud data + CFPB staffing reduction"). Drafter prompt is given both source URLs and asked to weave them. |

Optional flag for the user-pasted-content case (regulator emails, no URL):
- `/suggest text <paragraph>` — accept free text as the source material instead of fetching a URL. Stored as `source_text` on the topic; drafter uses that instead of a fetched page preview.

### Build estimate

- Slash command webhook handler: ~30 LOC in `src/routes/webhooks.js`
- Topic-insertion logic: reuses existing `/api/suggest-topic` flow
- "Pair" mode requires a small drafter prompt addition (passes both URLs as `topic.related_urls`)
- Free-text mode requires a `source_text` column on `content_topics` (~5 LOC migration)

Total: ~2-3 hours including testing. No new external dependencies.

---

## 3. Newsletter module — biweekly to start

**Decision: build as a new pipeline stage in the same repo, not a separate agent.**

A newsletter is a different artifact (curatorial, not analytical) but shares ~70% of its infrastructure with the blog pipeline: voice fingerprint, Anthropic client, Slack approval flow, Sanity-adjacent data model, judge pattern. A separate repo doubles deploy/CI overhead for no benefit at this scale.

### 3.1 Pipeline shape

```
content_drafts (past 14 days, judge_pass=true, published)
        │
        ▼
  Curator agent ──── selects 3-5 drafts (diversity + relevance)
        │
        ▼
  Composer agent ── writes intro, outro, per-post summaries, "also worth attention"
        │
        ▼
  Newsletter Judge ─ separate criteria from blog judge
        │
        ▼
  Slack approval ── preview message with Approve / Edit / Schedule / Reject
        │
        ▼
  Email service ─── Beehiiv / ConvertKit / Mailchimp API
        │
        ▼
  Analytics ─────── 24h + 7d open/click stats stored against the issue
```

### 3.2 Database

New tables in `src/db/migrations/008_*.sql`:

```sql
content_newsletters (
  id              UUID PRIMARY KEY,
  issue_number    INTEGER,
  subject_line    TEXT,
  preview_text    TEXT,           -- inbox snippet
  intro_body      TEXT,           -- Bo's personal intro (Markdown)
  outro_body      TEXT,           -- Bo's personal outro
  draft_ids       UUID[],         -- featured posts, in display order
  manual_items    JSONB,          -- "also worth attention" — title + url + 2-sentence summary
  status          TEXT,           -- 'draft', 'review', 'approved', 'scheduled', 'sent', 'failed'
  email_provider  TEXT,           -- 'beehiiv', 'convertkit', 'mailchimp'
  campaign_id     TEXT,           -- provider's ID after send
  scheduled_for   TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  subscriber_count_at_send INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
)

content_newsletter_analytics (
  id                    UUID PRIMARY KEY,
  newsletter_id         UUID REFERENCES content_newsletters,
  measured_at           TIMESTAMPTZ,
  measurement_window    TEXT,     -- '24h', '7d'
  delivered             INTEGER,
  opens                 INTEGER,
  unique_opens          INTEGER,
  clicks                INTEGER,
  unique_clicks         INTEGER,
  bounces               INTEGER,
  unsubscribes          INTEGER,
  click_breakdown       JSONB     -- per-link click counts
)
```

### 3.3 Curator stage (`src/pipeline/newsletter-curator.js`)

LLM call given a list of candidate drafts (title + slug + first paragraph + judge composite + category) from the past 14 days. Selects 3-5 to feature with rationale.

Selection criteria, ordered:

1. **Practice diversity** — no two on the same regulatory subject (avoid two stablecoin posts back-to-back).
2. **Recency mix** — at least one from the last 5 days, at least one earlier.
3. **Composite ≥ 8.0** — only feature posts that passed cleanly without revision-loop drama.
4. **Engagement signal** — if LinkedIn impressions data is available (post-Phase-3), prefer high-performing posts.

If fewer than 3 eligible drafts exist, the cron skips the issue and notifies Slack ("not enough material this fortnight; consider /suggest some catch-up topics").

### 3.4 Composer stage (`src/pipeline/newsletter-composer.js`)

Takes the curator output + 0-3 manual items (from `/suggest newsletter <url>`). Generates:

- **Subject line** — 30-50 chars, scroll-stopping. Lead with a number or named regulator if possible. NO clickbait, NO "Don't miss…" formulations.
- **Preview text** — 90-130 chars, fills the inbox preview pane. Should NOT duplicate the subject line.
- **Personal intro** (1-2 paragraphs) — Bo's voice, slightly more personal than blog. Ties the issue's posts together with a thread or theme.
- **Per-post summary** — 2-3 sentences per featured post + a "Read more →" link to the published blog URL. NOT a recap; should give the reader a reason to click.
- **"Also worth your attention"** section (optional) — manual items, 1-2 sentences each.
- **Personal outro** (1 paragraph) — what Bo is watching next, optional ask (consultation / referral / share).
- **Footer** — disclaimer + unsubscribe link (CAN-SPAM compliance).

### 3.5 Newsletter prompt (`src/prompts/newsletter-system.js`)

Distinct from `drafter-system.js`. Different voice calibration:

- More personal, less analytical. "This week I noticed…" instead of "The SEC just issued…"
- Curatorial framing: positions Bo as a guide through the noise, not the lecturer.
- Permitted: first-person editorializing ("I think the most underrated story this issue is…")
- Banned: same banned phrases as blog ("navigate the complex landscape" etc.) + fabricated anecdotes rule still applies (Bo is the author, but the LLM doesn't invent specific people / conversations / clients).

### 3.6 Newsletter Judge

Lighter than the blog judge because the linked posts already passed the blog judge. Criteria:

| Criterion | Weight | What it checks |
|---|---|---|
| Voice match | 1.5× | Bo's newsletter voice, no banned phrases, no fabricated anecdotes |
| Hook strength | 1.0× | Subject line + intro grab attention; preview text complements rather than duplicates |
| Curation diversity | 1.0× | The 3-5 picks are not redundant; the issue tells a thematic story |
| Summary specificity | 1.0× | Each post summary gives a concrete reason to click; no generic recaps |
| Compliance | 1.5× | Disclaimer present; no legal-advice claims; no contradictions with the source posts |

Composite + verdict computed in code (same `verdict.js` pattern as Phase 1).

### 3.7 Slack approval flow

Reuses `sendReviewMessage` pattern from blog flow but with newsletter-specific buttons:

- **Approve & schedule** — opens a date picker (defaults to next Sunday 6 PM ET)
- **Approve & send now** — fires immediate send via email provider API
- **Request edits** — text input for feedback; one composer revision pass
- **Reject this issue** — marks status=failed, no send, no retry

### 3.8 Email provider — recommendation: Beehiiv

| Provider | Pros | Cons |
|---|---|---|
| **Beehiiv** ★ | Newsletter-native, clean API, free up to 2,500 subs, built-in subscribe page, analytics included | Newer; smaller integration ecosystem |
| ConvertKit | Mature creator-focused, good automation | $29/mo at the entry tier; complex segmenting needed for legal-newsletter case |
| Mailchimp | Well-known, broad integrations | Heavyweight API; pricing scales aggressively |
| Substack | Effortless, audience built in | No API, no automation, can't programmatically send |

Beehiiv is the recommended starting point. Migration path: subscribers can be CSV-imported from any other provider later if needed.

API surface needed:
- `POST /v2/publications/{pub_id}/posts` — create draft
- `PUT /v2/publications/{pub_id}/posts/{post_id}/schedule` — schedule send
- `GET /v2/publications/{pub_id}/posts/{post_id}/stats` — pull analytics

All env-driven (`BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`).

### 3.9 Cron schedule

Default biweekly:

- **Friday 4 PM ET** (every other week) — curator + composer + judge run; Slack approval message goes out. Gives Bo the weekend to review.
- **Sunday 6 PM ET** (the same week) — if approved-and-scheduled, send fires.
- **Monday 9 AM ET + Friday 9 AM ET (one week later)** — analytics pulls (24h + 7d windows).

Configurable: `NEWSLETTER_CADENCE_DAYS` (14 default, 7 for weekly), `NEWSLETTER_DRAFT_CRON`, `NEWSLETTER_SEND_DEFAULT_HOUR`.

### 3.10 Manual injection into a newsletter

Reuses the `/suggest` Slack command from §2 with a `newsletter` flag:

```
/suggest newsletter <url>            ← adds to next issue's "also worth attention"
/suggest newsletter pair <url1> with <url2>   ← Bo's editorial picks
```

Items added this way go into `content_newsletters.manual_items` for the upcoming issue.

### 3.11 Build estimate

| Module | LOC | Hours |
|---|---|---|
| Migration 008 (newsletter tables) | ~80 | 0.5 |
| `pipeline/newsletter-curator.js` | ~150 | 2 |
| `pipeline/newsletter-composer.js` | ~200 | 3 |
| `prompts/newsletter-system.js` | ~120 | 1 |
| `pipeline/newsletter-judge.js` | ~150 | 2 |
| `integrations/beehiiv.js` | ~150 | 2 |
| Slack approval flow extension | ~80 | 1 |
| Cron wiring + analytics pulls | ~80 | 1 |
| Tests (unit + integration) | ~250 | 3 |
| **Total** | ~1,260 | **~16 hours** |

Approximately 2 working days. Can ship behind a feature flag (`ENABLE_NEWSLETTER=false` by default) and turned on once the first issue clears Slack approval cleanly.

---

## 4. Email ingestion — deferred

Forwarding regulator emails to the agent is high-value but heavy to build:

- Gmail API auth (OAuth flow + token refresh)
- Email parsing (subject, sender, body, attachments)
- Dedup against existing topics (regulators often re-send / forward agency alerts)
- Spam filtering (don't ingest marketing emails)
- Trust model (only ingest from a curated allowlist of regulator domains)

Estimated 4-6 hours and adds a meaningful new failure surface (Gmail auth expiration, rate limits, parsing edge cases). Defer until the `/suggest` command proves insufficient — if Bo finds himself copy-pasting regulator emails into Slack >5 times per week, that's the trigger to build email ingestion.

---

## 5. Recommended sequencing

| # | Item | Hours | Trigger to start |
|---|---|---|---|
| 1 | Phase 1 deploy soak (cron runs, LinkedIn formatting, DeFi revision) | — | done; observe through 2026-05-07 |
| 2 | Slack `/suggest` command | ~3 | after #1, if soak is clean |
| 3 | Newsletter module (behind `ENABLE_NEWSLETTER=false` flag) | ~16 | after #2 ships and is exercised at least once |
| 4 | First newsletter issue (manually triggered, full review cycle) | ~2 | after #3 deploys |
| 5 | Newsletter cron auto-runs biweekly | — | after #4 ships clean |
| 6 | Email ingestion | ~6 | only if Bo is copy-pasting regulator emails into Slack frequently |

---

## 6. Open questions

1. **Email service choice** — confirm Beehiiv before building, or evaluate ConvertKit's automation features against the use case?
2. **Subscriber list source of truth** — does Bo have an existing list (Mailchimp / Substack / spreadsheet) that needs to migrate to Beehiiv first?
3. **Newsletter brand** — does it have a name distinct from "FinTech Law"? Affects subject line conventions and footer.
4. **Compliance review** — Bo's jurisdiction (Florida, federal practice) — any state-specific marketing rules for legal newsletters beyond CAN-SPAM (e.g., bar advertising rules requiring "ATTORNEY ADVERTISING" header)?
5. **Newsletter analytics in weekly Slack report** — fold into the existing weekly report or separate channel?

---

## 7. Non-goals

- Twitter/X newsletters (Substack-style threads) — not in scope.
- Multi-author newsletters — Bo is the sole author for the foreseeable future.
- Newsletter A/B testing of subject lines — defer until issue volume justifies it (>20 issues sent).
- Personalized newsletter variants per subscriber segment — defer until subscriber count + segmentation data justifies the complexity.
