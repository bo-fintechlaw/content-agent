# FTL Content Agent — Editorial Intelligence Proposal v1

**Status:** Phase 1 + Phase 2 shipped 2026-05-07; Phase 3 (engagement feedback) partially shipped 2026-05-09 — GSC half live, LinkedIn half pending CSV
**Author:** Editorial scoping session, 2026-05-07
**Last updated:** 2026-05-09
**Companion to:** `CLAUDE.md` (system spec), `FTL_Prompt_Architecture_Proposal_v1.md` (prompt arch), `FTL_Pipeline_Roadmap_v1.md` (cadence + newsletter)

This doc captures three editorial concerns surfaced after the first week of soak: (1) source/topic diversity, (2) under-representation of primary-regulator material, and (3) the agent's lack of memory of its own prior work. None of these are addressed in the existing planning docs.

---

## 1. Diagnosis

### 1.1 PYMNTS / digital-asset dominance

The drafter's daily picker (`drafter.js:60-66`) is `WHERE status='ranked' ORDER BY relevance_score DESC LIMIT 1`. There is no diversity guard — no category mix, no source mix, no awareness of what shipped this week. If three high-scoring crypto/PYMNTS pieces stack up in the queue, three crypto/PYMNTS pieces ship in a row. Observed in production through 2026-05-07.

The newsletter section of the pipeline roadmap (§3.3) does have a "practice diversity" rule, but it only applies to newsletter curation of already-published posts. It is never consulted during blog selection.

### 1.2 Under-representation of primary regulators

`sources.js` already pulls SEC press releases, SEC litigation, SEC speeches/statements, OCC News, OCC Speeches, and CFPB. The shortfall is two-part:

- **Coverage gaps** — no FinCEN, no CFTC, no FDIC enforcement, no NY DFS, no DOJ press, no FinRA, no Federal Reserve enforcement. For a fintech-law practice these are first-class sources.
- **Ranker bias against dry copy** — regulator press releases are factual and unstoried; the ranker's hook/engagement signals reward news-shaped copy. A 7-on-news-shape SEC release loses to an 8-on-news-shape PYMNTS rehash, even though the SEC release is the actual primary source.

The Phase 3 "Researcher" agent in the prompt-architecture proposal pre-fetches primary sources *after* a topic is picked. It improves draft accuracy but does not change what gets picked.

### 1.3 No memory of prior FTL posts

The drafter has no awareness of FTL's published corpus. It cannot:

- Cross-link to a prior FTL post on the same regulator action.
- Avoid duplicating angles already covered in the last 30 days.
- Position a new post as a follow-up to a series ("part 3 of our running coverage of the SEC's crypto rulemaking").

Both planning docs are silent on this. The roadmap mentions LinkedIn impressions only for *newsletter* curation, post-Phase-3 (§3.3 of roadmap). There is no analytics retrieval shipped yet, no prior-post index, no internal-link generator.

This is the gap that turns episodic "news clips" into running commentary — the brand-voice difference between an aggregator and a practice's body of work.

---

## 2. Target features

### 2.1 Source-and-topic diversity guard

When the drafter's picker runs, downrank topics that match recently-published material along three axes:

| Axis | Window | Penalty | Source of truth |
|---|---|---|---|
| **Source name** (e.g. "PYMNTS") | last 7 days | -2.0 to relevance | `content_drafts.source_name` (joined via topic) |
| **Category** (e.g. `crypto`) | last 7 days | -1.0 per same-category post | `content_drafts.topic_category` |
| **Topic similarity** (title overlap) | last 14 days | -1.5 if Jaccard ≥ 0.4 on title trigrams | new `published_posts_index` table |

Implemented as a single helper `applyDiversityPenalty(candidates, recent)` invoked between the SQL `ORDER BY relevance_score` and the final pick. Picker selects the highest *adjusted* score, breaks ties on raw score. No DB schema change for axes 1 and 2 (data already present); axis 3 needs the index from §2.3.

### 2.2 Government-source coverage + primary-regulator boost

**A. Add 8 government feeds to `sources.js`** — verified as actual working RSS endpoints (2026-05-07):

| Source | Feed URL | Category |
|---|---|---|
| CFTC Press Releases | `cftc.gov/RSS/RSSGP/rssgp.xml` | `regulatory` |
| CFTC Enforcement | `cftc.gov/RSS/RSSENF/rssenf.xml` | `regulatory` |
| CFTC Speeches & Testimony | `cftc.gov/RSS/RSSST/rssst.xml` | `regulatory` |
| Federal Reserve Press | `federalreserve.gov/feeds/press_all.xml` | `regulatory` |
| Federal Reserve Enforcement | `federalreserve.gov/feeds/press_enforcement.xml` | `regulatory` |
| FDIC News (GovDelivery) | `public.govdelivery.com/topics/USFDIC_15/feed.rss` | `regulatory` |
| US Treasury News (GovDelivery) | `public.govdelivery.com/topics/USTREAS_88/feed.rss` | `regulatory` |
| DOJ News | `justice.gov/news/rss` | `regulatory` |

**Skipped (no parseable RSS as of 2026-05-07):** FinCEN (email-only via GovDelivery subscriber accounts), FinRA (JS-rendered news pages with no `<link rel="alternate">` feed), NY DFS (no advertised feed; their press-release URL patterns 404 on every variant probed).

**B. Ranker primary-source boost.** A small additive bonus when a topic's `source_url` host matches a primary-regulator allow-list:

```js
const PRIMARY_REGULATOR_HOSTS = new Set([
  'sec.gov', 'cftc.gov', 'fincen.gov', 'occ.gov', 'fdic.gov',
  'consumerfinance.gov', 'federalreserve.gov', 'dfs.ny.gov',
  'finra.org', 'justice.gov',
]);
```

Bonus: `+1.0` to the final composite when the host is on the list. Rationale: a regulator press release is a primary source, which has structurally higher value for a legal analysis blog than a news rehash even if the story-shape is duller. Applied in `verdict.js` (`computeRankerWeightedScore`) so the bonus is visible in the `relevance_score` field, not hidden in a picker-time adjustment.

### 2.3 Prior-posts index + cross-reference pass

**Goal:** make the drafter aware of its own corpus so it can reference earlier FTL posts when topically related.

**Index** — new table `published_posts_index`:

```sql
CREATE TABLE published_posts_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id        UUID REFERENCES content_drafts(id) ON DELETE CASCADE,
  published_url   TEXT NOT NULL,           -- https://fintechlaw.ai/blog/<slug>
  blog_title      TEXT NOT NULL,
  blog_slug       TEXT NOT NULL,
  category        TEXT,                    -- topic category at publish time
  source_name     TEXT,                    -- which RSS source this came from
  first_paragraph TEXT,                    -- first ~600 chars for retrieval
  published_at    TIMESTAMPTZ NOT NULL,
  search_tsv      tsvector                 -- generated col on title + first_paragraph
                  GENERATED ALWAYS AS (
                    to_tsvector('english',
                      coalesce(blog_title,'') || ' ' || coalesce(first_paragraph,''))
                  ) STORED
);
CREATE INDEX ON published_posts_index USING GIN (search_tsv);
CREATE INDEX ON published_posts_index (published_at DESC);
```

**Write path** — `publisher.js` writes a row after Sanity publish + Netlify rebuild succeed. Idempotent on `draft_id`.

**Read path** — new pre-drafter step `findRelatedPriorPosts(topic)` does a Postgres FTS match on the new topic's title + summary against `search_tsv`, returns up to 3 prior posts with title + URL + category + 1-line snippet. Passed to `buildDrafterUserPrompt` as `relatedPriorPosts[]`.

**Drafter prompt addition** (small): a `<related_prior_posts>` block in the user prompt with instructions to weave 1-2 inline links *only when topically natural* — not gratuitously. The voice critic / judge already flags artificial linking on its existing structure rubric, so over-linking will fail review.

**Why FTS, not embeddings.** Corpus is ~100 posts and grows ~5/week. Postgres FTS is 30 LOC, no new dependency, no API key, and quality-good-enough for "find the post that overlaps". Embeddings (pgvector + OpenAI text-embedding-3-small) become worth it past ~500 posts or when topical similarity gets non-lexical. Documented as a Phase 3 upgrade.

### 2.4 Engagement feedback loop (Phase 3 — partially shipped 2026-05-09)

**Shipped:** CSV-based analytics ingestion (`POST /api/analytics/import` + `npm run analytics:import`) writing to extended `content_analytics` (migration 010 + idem-key fix 011). Ranker now pulls top LinkedIn posts (when imported), GSC near-miss queries, and CTR-gap pages on every run and surfaces them as anchors via `analytics-feedback.js` → `ranker-system.js`. The ranker is told to apply +1 boosts on `engagement_potential` (near-miss capture) and `seo_fit` (CTR-gap overlap). 1-hour in-process cache; cleared on every fresh import.

**First import (2026-05-09):** GSC chart 89 daily rows, GSC pages 102 rows (utm-tagged dupes merged into canonical URLs), GSC queries 1,000 rows. Page→draft attribution returned 0 because the high-traffic GSC pages are pre-agent manual blogs not present in `published_posts_index`.

**Outstanding:**
- **LinkedIn CSV** — parser supports the export shape but no LinkedIn data has been ingested yet. Bo has the manual export; importer awaits the file.
- **published_posts_index Sanity backfill** — currently only contains agent-published drafts (17). The pre-agent blogs (Solana ETF, Erebor, AI-native law firms, Rari Capital, Macquarie) are absent, so GSC pages can't attribute to a `draft_id`. Hint formatting works without `draft_id` (uses URLs directly), but downstream features needing `draft_id` are blocked. Fix: backfill from Sanity API rather than `content_drafts`.
- **Title/meta CTR fix loop** — automated alternate-title generation for pages with position ≤10 + CTR <0.5% over 30 days, Slack-routed for one-click swap into Sanity. Highest-impact opportunity (Solana ETF alone: 23,064 impressions / 0.00% CTR). Deferred until 2 weeks of imported data confirms the pattern is stable.
- **Auto-import cron** — currently CSV imports are manual. Once Bo has a stable export cadence (or LinkedIn API access with `r_organization_social`), wire a daily/weekly fetcher that reads from Drive/email/API directly.

---

## 3. Phased plan

### Phase 1 — Diversity & primary-source bias (this proposal, item 1) ✅ shipped 2026-05-07

| Step | File | Status |
|---|---|---|
| 1A. Add 8 government feeds | `src/config/sources.js` | ✅ |
| 1B. Verify each feed parses | inline curl probes during PR | ✅ |
| 1C. Add `PRIMARY_REGULATOR_HOSTS` allow-list | `src/pipeline/verdict.js` | ✅ |
| 1D. Wire +1.0 boost into `computeRankerWeightedScore` | `src/pipeline/verdict.js`, `src/pipeline/ranker.js` | ✅ |
| 1E. Helper `applyDiversityPenalty` w/ source + category penalties | new `src/pipeline/diversity.js` | ✅ |
| 1F. Drafter picker consults diversity helper | `src/pipeline/drafter.js` | ✅ |
| 1G. Tests | `src/__tests__/pipeline/diversity.test.ts` (8) + verdict (extended) | ✅ |

Topic-similarity diversity (axis 3 of §2.1) waits for §2.3's index.

### Phase 2 — Prior-posts index (this proposal, item 2) ✅ shipped 2026-05-07

| Step | File | Status |
|---|---|---|
| 2A. Migration `009_published_posts_index.sql` (numbered after existing 008) | `src/db/migrations/` | ✅ |
| 2B. Publisher writes to index after Sanity publish | `src/pipeline/publisher.js` | ✅ |
| 2C. Backfill script for existing Sanity corpus | `scripts/backfill-prior-posts-index.mjs` | ✅ |
| 2D. `findRelatedPriorPosts(supabase, topic)` helper | new `src/pipeline/prior-posts.js` | ✅ |
| 2E. Drafter consumes related-posts list | `src/pipeline/drafter.js`, `src/prompts/drafter-system.js` | ✅ |
| 2F. Tests | `src/__tests__/pipeline/prior-posts.test.ts` (8) | ✅ |
| 2G. Topic-similarity diversity (closes §2.1 axis 3) | `src/pipeline/diversity.js` | deferred |

**Manual deploy steps after merge:**
1. Apply migration `009_published_posts_index.sql` in Supabase.
2. Run `node scripts/backfill-prior-posts-index.mjs` once to seed the index from existing published drafts.

### Phase 3 — Embedding upgrade + engagement loop (partially shipped 2026-05-09)

| Step | File | Status |
|---|---|---|
| 3A. Migration 010 — extend `content_analytics` (metric_kind, url, query, clicks, position, period_start/end, idem_key) | `src/db/migrations/010_analytics_extensions.sql` | ✅ |
| 3B. Migration 011 — non-partial idem_key unique index (ON CONFLICT compatibility) | `src/db/migrations/011_analytics_idem_index_fix.sql` | ✅ |
| 3C. CSV importer w/ RFC-4180 parser, multi-line URL handling, idem-key dedupe + aggregation | `src/pipeline/analytics-import.js` | ✅ |
| 3D. Ranker hints helper w/ 1h cache | `src/pipeline/analytics-feedback.js` | ✅ |
| 3E. `POST /api/analytics/import` (CSV body or JSON) + `GET /api/analytics/hints` | `src/routes/api.js` | ✅ |
| 3F. CLI: `npm run analytics:import gsc-folder <path>` | `scripts/import-analytics.mjs` | ✅ |
| 3G. Ranker prompt + runner integration | `src/prompts/ranker-system.js`, `src/pipeline/ranker.js` | ✅ |
| 3H. First GSC import + verification | content-agent Supabase | ✅ |
| 3I. LinkedIn CSV import | importer ready; awaiting Bo's export | 🟡 |
| 3J. Sanity-driven backfill of `published_posts_index` | new script needed | ⏳ |
| 3K. Title/meta CTR fix loop (auto-suggest alternates for poor-CTR top-ranked pages) | new pipeline stage | ⏳ |
| 3L. pgvector + `text-embedding-3-small` (replace FTS at ~500 posts) | `src/pipeline/prior-posts.js` | ⏳ (not yet warranted; corpus = ~17 agent + ~30 manual) |

---

## 4. Test strategy

### Phase 1
- Unit: `applyDiversityPenalty([candidates], [recent])` — assert source-day-of-7 hits the right penalty, category run-of-3 hits cumulative penalty, no penalty when queue is fresh.
- Integration: seed `content_drafts` with three same-source published rows over the last 7 days, run picker, confirm a different-source candidate at lower raw relevance is selected.
- Live: monitor 7 days of selections; expect at most 2 PYMNTS picks per 7-day window. If still seeing 3+, raise the per-source penalty.

### Phase 2
- Unit: `findRelatedPriorPosts` returns 0 results on an empty corpus, 0 results when topic title shares no terms with any prior post, top-N when multi-term overlap.
- Integration: backfill 5 fixture posts, run drafter on a topic that overlaps two of them, assert the drafter prompt contains both URLs.
- Live: track over the next 10 published drafts how many include cross-links, and how many of those links are still relevant under judge review.

---

## 5. Open questions

1. **Diversity penalties tunable?** Source-day-7 = -2.0 is the working number. Should it be configurable (`content_config` row) so we can tweak without redeploy?
2. **Cross-link cap.** Max 1, max 2, max 3 per post? My instinct is 2 — one inline early ("we examined this in [prior post]"), one in closing if natural. Higher cap risks gratuitous linking.
3. **Backfill source.** Pull from Sanity API or from the existing Netlify-built sitemap? Sanity is canonical but slower; sitemap is fast but lossy on category/source metadata.
4. **Do we want a "thread" concept?** Explicit multi-part series support (e.g. `parent_post_id` on `published_posts_index`) so a post can be flagged "part 2 of X." Probably a Phase 3 concern, but worth flagging if the drafter's first attempts produce series-shaped output organically.

---

## 6. Non-goals

- No semantic embeddings in this proposal. Postgres FTS is sufficient for the current corpus size.
- No engagement-driven ranker bias. Defer until analytics retrieval is built.
- No automatic "thread" / multi-part post structure. Drafter may produce them organically; explicit modeling is a later concern.
- No changes to the judge's scoring rubric. Cross-references are enabled but not rewarded — they should appear when natural and be silent when not.
- No new external API dependencies (no OpenAI for embeddings, no separate search service).
