# FTL Content Agent — Session Summary
**Date:** April 1, 2026

---

## What We Built

### Pipeline (all stages implemented, deployed, and tested)
1. **Scanner** — 24 RSS feeds (SEC, CFTC, OCC, FinCEN, CFPB, Anthropic, OpenAI, NVIDIA, Rohan's Bytes, The Rundown AI, CoinDesk, CoinTelegraph, The Block, Decrypt, Finextra, PYMNTS, American Banker, Crunchbase, TechCrunch AI/Fintech, VentureBeat AI, Artificial Lawyer, ACM TechNews). 48-hour recency filter, 10 articles per feed cap.
2. **Ranker** — Claude scores topics on 5 weighted criteria, selects top 3 per run.
3. **Drafter** — Claude generates blog + social content with full Bo Howell voice fingerprint (editorial philosophy, sentence architecture, analytical moves, banned phrases, 3 exemplar post patterns). 8000 max tokens.
4. **Judge** — Weighted composite scoring (accuracy 1.5x, voice 1.25x, engagement 1.0x, structure 1.0x, SEO 0.75x). PASS >= 8.0, REVISE, or REJECT. One revision pass, then sends to Slack regardless with judge notes.
5. **Slack Blog Review** — Blog-only preview with composite score, individual scores, blog body preview. Approve/Request Changes/Reject buttons.
6. **Sanity Publisher** — Creates blog document, generates featured image via Grok Imagine (xAI), publishes, triggers Netlify rebuild.
7. **Slack Social Review** — Separate message after blog publishes. Shows LinkedIn + X drafts. Approve/Request Changes/Skip buttons.
8. **Social Poster** — Posts to LinkedIn + X only after explicit social approval (`social_approved = true`).
9. **Social Reviser** — When feedback submitted on social posts, Claude regenerates just the social content and resends to Slack for re-approval.

### Infrastructure
- **Deployed on Railway** at `ftl-content-agent-production.up.railway.app`
- **Database:** Supabase (5 migrations, all run)
- **CMS:** Sanity (blog document type)
- **Website:** fintechlaw.ai hosted on Netlify (static site generation)
- **Cron:** Daily source scan at 6 AM ET, orchestration every 15 minutes
- **Slack app:** Interactivity URL set to `https://ftl-content-agent-production.up.railway.app/slack/interactions`

### Prompt Engineering
- Full voice fingerprint extracted from 3 published posts (Baker McKenzie, Ad Astra, SEC Crypto Taxonomy)
- "Lead with what BigLaw buries" editorial philosophy
- Banned phrases list (AI slop detection)
- Critical rule: never fabricate personal anecdotes
- Exemplar post patterns for regulatory enforcement, thought leadership, and data-driven analysis
- Judge detects banned phrases, contractions, and fabricated experiences

### Blog Categories (updated)
- `regulatory` — SEC, CFTC, CFPB, compliance guidance
- `digital-assets` — Crypto regulation, tokenization, DeFi, ETFs
- `ai-legal` — AI in legal services, legal engineering, legal tech
- `startup` — Fintech startup guidance, funding, formation
- `enforcement` — Enforcement actions, case studies, penalty analysis

Updated in: Sanity schema, frontend filter dropdown, drafter prompt.

### API Endpoints
- `GET /api/scan-now` — Trigger RSS scan
- `GET /api/rank-now` — Trigger topic ranking
- `GET /api/draft-now` — Trigger content drafting
- `GET /api/judge-now` — Trigger quality judging
- `GET /api/publish-now?draftId=<id>` — Publish specific draft
- `GET /api/social-now` — Trigger social posting
- `GET /api/orchestrate-now` — Full publish + social
- `POST /api/suggest-topic` — Manually inject topic `{title, url, summary, category}`
- `POST /api/revise-social` — Revise social posts `{draftId, feedback}`
- `GET /api/topics` — List topics
- `GET /api/drafts` — List drafts
- `GET /api/health` — Full health check with DB status

---

## Test Results

- **First scan:** 24 feeds processed, 1,114 topics inserted (before cap), 10 after cap
- **First draft with voice fingerprint:** PASS on first attempt, composite 8.5/10
  - Accuracy: 7, Engagement: 9, SEO: 8, Voice: 9, Structure: 9
- **Blog title:** "CFPB Workforce Cuts: What Fintech Startups Must Do Now"
- **Published to Sanity:** Document ID `8bd925f8ad24b738d373`
- **Slack approval flow:** Working (blog review → approve → social review → request changes → revision → re-review)
- **Social revision:** Successfully regenerated social posts without fabricated anecdotes after feedback

---

## To Do Next Session

### Immediate (need credentials)
1. **Create xAI API key** at https://console.x.ai → add `XAI_API_KEY` to Railway env vars
2. **Create Netlify build hook** (Site config → Build & deploy → Build hooks → name it `content-agent`) → add `NETLIFY_BUILD_HOOK` to Railway env vars
3. **Test full pipeline end-to-end** with image generation and Netlify auto-rebuild

### Short Term
4. **Re-categorize existing 60+ blog posts** from old categories (casestudy/funding/business/startup) to new ones (regulatory/digital-assets/ai-legal/startup/enforcement) in Sanity
5. **Verify CFPB blog post renders** on fintechlaw.ai after Netlify rebuild

### Medium Term
6. **Analytics collection** — Build periodic jobs to pull engagement metrics from LinkedIn API, X API, Google Analytics. Populate `content_analytics` table. Feed performance data back into ranker.
7. **Content scheduling** — Queue system for optimal posting times instead of immediate publish (LinkedIn performs best Tue-Thu mornings)
8. **Email/newsletter integration** — Auto-generate weekly digest from published content (Mailchimp/ConvertKit/Beehiiv)

---

## Repos
- **Content agent:** https://github.com/bo-fintechlaw/content-agent (main branch)
- **Website:** https://github.com/FinTechLegal/fintechlegal_website (main branch)

## Key Files
- Drafter prompt: `ftl-content-agent/src/prompts/drafter-system.js`
- Judge prompt: `ftl-content-agent/src/prompts/judge-system.js`
- RSS sources: `ftl-content-agent/src/config/sources.js`
- SEO keywords: `ftl-content-agent/src/config/seo-keywords.js`
- Sanity publisher: `ftl-content-agent/src/pipeline/publisher.js`
- Image generator: `ftl-content-agent/src/integrations/image-generator.js`
- Slack integration: `ftl-content-agent/src/integrations/slack.js`
- Webhooks (Slack actions): `ftl-content-agent/src/routes/webhooks.js`
- Social reviser: `ftl-content-agent/src/pipeline/social-reviser.js`
- Sanity blog schema: `studio/schemaTypes/blogType.js` (in website repo)
