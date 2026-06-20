# FTL Content Agent — Pipeline Roadmap v1

**Status:** Phase 1 deploy soak complete; analytics ingestion + ranker feedback shipped 2026-05-09. Slack `/suggest` and newsletter module remain.
**Author:** Roadmap session, 2026-04-30
**Last updated:** 2026-05-09
**Companion to:** `FTL_Prompt_Architecture_Proposal_v1.md` (prompt architecture), `FTL_Editorial_Intelligence_v1.md` (diversity + prior-posts + analytics)

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

## 3. Newsletter module — v2 (CMO + content-agent, Resend)

**Supersedes v1 in-repo curator/composer/judge/Beehiiv design.** See Newsletter Automation v2 integration plan.

**Architecture:** CMO assembles Issue JSON → content-agent `render_newsletter_issue` → Bo approves `newsletter_issue_draft` in `#cmo-bo` (`C0BB9U7AN0Y`) via `@ftl/agent-core` → content-agent publishes.

### 3.1 Pipeline shape

```
Notion editorial calendar
        │
        ▼
  CMO (ftl-cmo-agent) ── blog GROQ from published_posts_index
        │
        ▼
  Issue JSON + compliance linter (deterministic)
        │
        ▼
  delegate_to_agent('content', 'render_newsletter_issue')
        │
        ▼
  content-agent ── Sanity preview, test email, carousel, Resend
        │
        ▼
  agent_action: newsletter_issue_draft → #cmo-bo (shadow, ceiling approve)
        │
        ▼
  Bo Approve → publish (Sanity + Resend broadcast + LinkedIn/X)
```

### 3.2 Database (migrations 015–016)

Fleet Supabase `wrxuyabngyaiujgcfexj`:

- `newsletter_issues` — canonical Issue JSON + render/publish state
- `subscribers`, `subscription_events` — consent + double opt-in
- `issue_metrics` — Resend webhooks + social/GA4 joins
- RLS: service-role only (016)

### 3.3 Segments

| Newsletter | segment key | Categories |
|---|---|---|
| The Financial Edge | `financial_services` | financial_services, regulatory, crypto, fintech |
| The Startup Solution | `tech_ai_legal` | ai_legal_tech, legal_engineering, startup |

Biweekly per segment (staggered anchors, both on Thursdays 7:30 AM ET):

| Newsletter | segment key | First issue | Then |
|---|---|---|---|
| The Financial Edge | `financial_services` | 2026-06-18 | Every 14 days |
| The Startup Solution | `tech_ai_legal` | 2026-06-25 | Every 14 days |

Schedule logic: `src/utils/newsletter-schedule.js`. Calendar: Notion `NOTION_DB_CONTENT_CALENDAR`.

### 3.4 Email + list

- **Resend** Broadcasts + Audiences (not Beehiiv)
- Zoho CSV → `subscribers` as `unconfirmed` → re-permission via `scripts/send-zoho-repermission.mjs`
- Subscribe API: `POST /api/newsletter/subscribe` with double opt-in confirm

### 3.5 Content-agent task API

Documented in `INTERFACE.md`:

- `POST /api/tasks/render-newsletter-issue`
- `POST /api/tasks/publish-newsletter-issue`
- `POST /api/newsletter/lint`

### 3.6 Slack approval

**Not** blog-channel `sendReviewMessage`. Newsletter uses agent-core card in `#cmo-bo`: Approve / Edit / Discard. `newsletter_issue_draft` is `NEVER_AUTO`.

### 3.7 Site (fintechlegal_website)

- Sanity `newsletter` schema
- `/newsletter/[slug]` indexable archive + JSON-LD
- Canonical middleware strips `utm_*`
- Scaffold: `fleet/fintechlegal_website/`

### 3.8 Cron

- Thursday 7:30 AM ET: `CMO_ASSEMBLE_URL` when `ENABLE_NEWSLETTER=true` — only fires for segments due that day (biweekly from anchors above); POST body `{ segment, issue_date }`
- Resend webhooks → `issue_metrics`

### 3.9 Fleet repos

- `bo-fintechlaw/ftl-cmo-agent` — CMO newsletter slice (standalone repo)
- `~/ftl-agent-core` — delegation, actions, Slack cards, autonomy ceilings
- `fleet/fintechlegal_website/` — site track

Ship behind `ENABLE_NEWSLETTER=false` until first shadow issue clears Bo review.

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

| # | Item | Hours | Status |
|---|---|---|---|
| 1 | Phase 1 deploy soak (cron runs, LinkedIn formatting, DeFi revision) | — | ✅ shipped + soaked |
| 2 | Editorial intelligence — diversity guard, primary-source boost, prior-posts cross-reference | — | ✅ shipped 2026-05-07 (see `FTL_Editorial_Intelligence_v1.md` Phases 1+2) |
| 3 | Analytics ingestion (CSV) + ranker feedback loop (GSC + LinkedIn) | — | ✅ shipped 2026-05-09 (see Editorial Intelligence Phase 3) |
| 4 | FinTech Law company-page LinkedIn posting (in addition to Bo personal) | ~3 | ⏳ pending FTL company URN + token w/ `w_organization_social` |
| 5 | LinkedIn CSV import (first run) — populates ranker hints w/ post performance | ~0.5 | ⏳ awaiting Bo's export |
| 6 | Sanity-driven backfill of `published_posts_index` (covers pre-agent blogs) | ~2 | ⏳ unblocks GSC page→draft attribution |
| 7 | Slack `/suggest` command | ~3 | ⏳ next planned build |
| 8 | Newsletter module (CMO assembles → content-agent renders; Resend + fleet Supabase) | ~16 | ⏳ in progress |
| 9 | First newsletter issue (manually triggered, full review cycle) | ~2 | ⏳ after #8 |
| 10 | Newsletter cron auto-runs Thursday 7:30 AM ET | — | ⏳ after #9 |
| 11 | Title/meta CTR fix loop for poor-CTR top-ranked pages | ~4 | ⏳ defer until ≥2 weeks of imported data |
| 12 | Email ingestion (regulator forwards) | ~6 | ⏳ only if `/suggest` proves insufficient |
| 13 | Enzio company-page posting + topic-routed content variants | ~6 | ⏳ deferred per 2026-05-08 decision |

### Open issues surfaced during operation

| # | Issue | Discovered | Priority | Notes |
|---|---|---|---|---|
| O1 | **Silent judge rejection after max revisions** — when a draft fails its post-revision re-judge, the loop ends and `content_topics.status='revision'` but no Slack notification fires. From the operator's side this looks indistinguishable from "the cron didn't run." Fix: emit a Slack message (`:warning: Draft rejected after revision: <title> — <flags summary>`) with links to the preview + a "force-publish" / "abandon" button pair. | 2026-05-09 | 🔴 high | Caused today's perceived no-fire incident. Real cause: judge correctly caught a fabricated ABA Tech Report stat (`draft 76e0f173…`); silence misled. |
| O2 | **Reviser cannot escape factually-contradicted loop** — auto-fix from commit `05362c2` rewrites the contradicted sentence, but the regenerated copy can re-introduce a near-equivalent claim and trip the same flag on re-judge. With `revision_count` capped at 1 the loop terminates failed. Fix: when the same flag re-fires, escalate the reviser's instruction (delete the entire offending paragraph, don't rewrite). Or: lift the cap to 2 specifically when only `factually_contradicted` remains. | 2026-05-09 | 🟠 medium | Same draft as O1. |
| O3 | **No "force-publish" path on stuck draft** — if the operator disagrees with the judge or wants to ship a near-pass post manually, there's no in-band tool. Currently must edit Sanity by hand. Fix: a Slack button or `POST /api/force-publish?draftId=…&token=…` that bypasses judge_pass and routes straight to publisher. | 2026-05-09 | 🟡 low | |
| O4 | **Topic queue starvation risk on Saturday/Sunday** — Monday-only weekly scan + ranker means by end-of-week the queue can be at 1-2 ranked topics. If today's topic gets stuck (as O1), next-day pick comes from a thin pool. Currently 254 pending, 2 ranked, 1 rejected, 4 published. Mitigation: extend ranker to run mid-week (Wed) on the cumulative backlog, not just Monday's scan. | 2026-05-09 | 🟡 low | Watch for 1-2 more weeks before acting. |

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
