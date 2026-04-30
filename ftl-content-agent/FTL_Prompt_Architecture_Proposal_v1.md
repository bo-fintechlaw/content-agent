# FTL Content Agent — Prompt & Multi-Agent Architecture Proposal v1

**Status:** Draft proposal, not yet implemented
**Author:** Architecture review, 2026-04-30
**Companion to:** `FTL_Content_Agent_Architecture_Spec_v1_0.md` (system-level spec)

---

## 1. Diagnosis of current prompt architecture

The current pipeline (`src/prompts/`) consists of four prompt files driving four LLM stages:

| File | Role | Diagnosis |
|---|---|---|
| `ranker-system.js` | Single-shot scorer | **Severely underspecified.** Two-line system prompt, no anchors, no exemplars, asks the LLM to compute a weighted average. |
| `drafter-system.js` | Mega-prompt single-shot | Excellent voice fingerprint, banned-phrases list, exemplar passages — but **kitchen-sink**: outline + headline + body + LinkedIn + X single + X thread + image prompt + SEO meta in one JSON. |
| `judge-system.js` | Single-shot evaluator | Clear weighted rubric, but **mixes scoring with revision-instruction generation** and asks the LLM to compute the composite. Verdict thresholds are defined twice with subtle conflict. |
| `citation-subagent.js` | Focused subagent | **Best-designed of the four** — single purpose, scoped to URL reachability + claim alignment from preview. |

Only one true subagent exists today (citation verification). Everything else is a single LLM pass.

### Specific issues

1. **Drafter does too many things at once.** Voice gets diluted because the same context window also juggles SEO keyword placement and tweet compression.
2. **No research/retrieval before drafting.** The drafter hallucinates citations, and the citation subagent catches broken URLs *after* a 7K-token generation has already been spent.
3. **No outliner stage.** Section structure is invented inside the same call that fills it in.
4. **Revision reuses the drafter prompt** with `revisionInstructions` appended. There is no surgical-revision agent that protects sections that already scored well.
5. **No voice-critic subagent.** Voice carries 1.25× weight (highest after accuracy) and is the brand fingerprint, but it is one of five things the omnibus judge evaluates simultaneously.
6. **Citation subagent only verifies reachability.** It does not assess whether the *claim* the link supports is correct.
7. **LLMs do the arithmetic.** Both ranker (`ranker-system.js:28`) and judge (`judge-system.js:43, 105`) compute weighted composites. Models routinely err by 0.1–0.5.
8. **Verdict thresholds defined twice and conflict.** Judge system says REVISE = "composite ≥ 5.0 OR at least one strong area"; user prompt says REVISE = "composite ≥ 5.0 or any score ≥ 8". PASS constraint "no individual below 6" appears only in system prompt.
9. **No XML-structured prompts.** ~7K-token drafter prompt is prose; tagging would noticeably improve adherence.
10. **No prompt caching.** Drafter and judge system prompts are static and large — perfect cache targets.
11. **No extended thinking / scratchpad.** Drafter's "self-check before output" gates are performative under JSON-only output — the model has no place to actually run them.
12. **Ranker has no anchors.** A `7` for `practice_relevance` means very different things across runs.

---

## 2. Target architecture

### 2.1 Pipeline shape (after change)

```
RSS → Scanner → Ranker → Researcher → Outliner → Drafter ⇄ Judge → Slack → Publisher → Social
                                                            │
                                                            ├── Citation Subagent (existing)
                                                            ├── Voice Critic Subagent (new)
                                                            └── Fact Subagent (new, optional)
```

After approval, **Social Adapter** runs as a separate stage on the *approved* draft (not bundled into the drafter call).

### 2.2 New / changed agents

| Agent | Type | Purpose | Output |
|---|---|---|---|
| **Researcher** (new) | Tool-using | Pre-fetch primary sources from `topic.source_url` and 1–2 related official URLs (regulator press releases, federal register, court filings). Web fetch + extraction. | `{primary_source, supporting_sources[], key_facts[], suggested_quotes[]}` |
| **Outliner** (new) | Single-shot | Given topic + research bundle, produce the section blueprint with the editorial pivot pre-decided. | `{headline, opening_pivot, sections[{title, point, evidence_refs}], takeaways[]}` |
| **Drafter** (refactored) | Single-shot, narrowed | Fill in the outline. Voice + Markdown rendering only. No SEO meta, no social, no image prompt. | `{blog_title, blog_slug, blog_body[]}` |
| **SEO Adapter** (new, small) | Single-shot | Given blog body, produce SEO title/description/keywords/category/tags. | `{blog_seo_title, blog_seo_description, blog_seo_keywords, blog_category, blog_tags}` |
| **Social Adapter** (new) | Single-shot | Given approved blog body, produce LinkedIn post + X single + X thread + image prompt. Runs *after* judge PASS, not before. | `{linkedin_post, x_post, x_thread[], image_prompt}` |
| **Revision Agent** (new) | Single-shot, focused | Given prior draft + judge revision instructions, surgically modify only the flagged sections. | Same shape as Drafter output |
| **Voice Critic** (new subagent) | Single-shot scorer | Score voice fingerprint match in isolation; no other criteria. Output feeds main Judge. | `{voice_score, fingerprint_misses[], banned_phrase_hits[]}` |
| **Citation Subagent** (existing) | Single-shot scorer | Unchanged. | (current) |
| **Fact Subagent** (new, optional v2) | Single-shot scorer | Given (claim, URL preview), assess support. | `{claim_assessments[]}` |
| **Judge** (refactored) | Single-shot evaluator | Score accuracy / engagement / SEO / structure. **Consume** voice + citation + fact subagent outputs. Emit revision instructions. **Composite computed in code, not LLM.** | `{scores, verdict, revision_instructions[], strengths[], flags[]}` |
| **Ranker** (refactored) | Single-shot scorer | With anchored exemplars. Composite computed in code. | `{scores, reasoning}` |

### 2.3 Cross-cutting prompt-engineering changes

- **XML structuring** for all multi-section prompts: `<task>`, `<voice_rules>`, `<banned_phrases>`, `<exemplar id="A">`, `<output_schema>`.
- **Prompt caching** on every static system prompt (drafter, judge, voice critic) — reduces token cost on retry/revision loops.
- **Extended thinking** enabled for Judge and Voice Critic (the reasoning-heavy stages). Drafter stays low-temperature without thinking to keep voice consistent.
- **JSON via tool-use schema**, not natural-language "JSON only" instructions. Eliminates malformed JSON entirely.
- **Composite arithmetic moved to code.** LLMs return per-criterion scores only.
- **Verdict thresholds defined once**, in code. Judge prompt only outputs scores + qualitative assessment; verdict is computed.
- **Prefilling**: assistant turns start with `{` for any non-tool-use JSON path that remains.

### 2.4 Per-prompt structural standard (template)

```
<role>One sentence: who you are and what you produce.</role>

<context>What stage you're in, what you receive, what consumes your output.</context>

<task>The single thing this prompt does. One verb.</task>

<rules>
  <rule>...</rule>
</rules>

<exemplars>
  <exemplar id="...">
    <input>...</input>
    <output>...</output>
  </exemplar>
</exemplars>

<output_schema>
  Tool-use schema or strict JSON shape.
</output_schema>
```

Every new prompt file follows this template.

---

## 3. Phased implementation plan

Phases are ordered by **risk-adjusted return**: mechanical wins first, then split-and-rewire, then new agents.

### Phase 1 — Mechanical fixes (low risk, fast)

Goal: stop the bleeding without changing the topology.

- **1A.** Move composite arithmetic out of judge prompt into `judge.js`. LLM returns per-criterion scores; code computes composite from canonical weights.
- **1B.** Move composite arithmetic out of ranker prompt into `ranker.js`. Same pattern.
- **1C.** Reconcile verdict thresholds. Define once in `src/pipeline/verdict.js`; judge prompt no longer states verdict logic.
- **1D.** Add anchor exemplars to `ranker-system.js` (3–4 worked examples spanning the score range).
- **1E.** Confirm or fix the auto-revision wiring on the Morgan Stanley case (diagnostic, code change only if a real defect is found).

**Tests:** existing `schemas/pipeline.test.ts` plus a small unit test for `computeComposite()`.

### Phase 2 — Drafter split (medium risk, big quality win)

Goal: separate concerns so voice is no longer competing with SEO/social inside one context.

- **2A.** Split `drafter-system.js` into `drafter-system.js` (blog body only) + `seo-adapter-system.js` + `social-adapter-system.js`.
- **2B.** Pipeline change: `drafter.js` calls drafter then SEO adapter; social adapter is moved to a new stage that runs after judge PASS / human approval (before publish).
- **2C.** New `revision-system.js` prompt; `runDrafting` selects revision prompt when `topic.status === 'revision'`.

**Tests:** integration test re-run on the Morgan Stanley topic; output shape validated against existing zod schemas (split between three calls, recomposed before insert).

### Phase 3 — New agents (higher risk, requires evals)

Goal: structured judging.

- **3A.** Add Voice Critic subagent. Judge consumes its score for the `voice` slot instead of producing it.
- **3B.** Add Researcher stage in front of drafter — fetches primary source + 1–2 supporting URLs, hands a `research_bundle` to the outliner/drafter so the drafter cites from a verified set rather than hallucinating links.
- **3C.** (Optional v2) Outliner stage. Only ship if 3A + 3B don't already lift the PASS rate enough.
- **3D.** (Optional v2) Fact subagent for claim-level support assessment.

**Tests:** A/B against held-out topics including the Morgan Stanley case. Baseline = current pipeline; treatment = post-Phase-3.

### Phase 4 — Anthropic platform features

- **4A.** XML-tag all prompt files using the standard template (Section 2.4).
- **4B.** Enable prompt caching on drafter, judge, voice-critic system prompts.
- **4C.** Switch JSON outputs to tool-use schemas where it reduces parsing complexity.
- **4D.** Enable extended thinking on Judge and Voice Critic.

---

## 4. Test strategy — Morgan Stanley article

The Morgan Stanley topic is the regression case. Before each phase ships:

1. **Snapshot** the current draft state (topic ID, latest draft ID, judge_scores, judge_flags, revision_count, human-feedback flags).
2. **Reset** the topic to `'ranked'` (or `'revision'` with the recorded human feedback intact) in a scratch row, not the production row.
3. **Re-run** through the pipeline using the manual triggers (`/api/draft-now?topicId=…`, `/api/judge-now?draftId=…`).
4. **Compare**: composite score, verdict, individual criterion scores, revision instruction quality, citation accuracy, voice-fingerprint adherence.
5. **Confirm** auto-revision actually fires on REVISE verdict if `revision_count < cap`.

Pass bar per phase:
- Phase 1: composite identical ±0.05 (pure refactor — should be deterministic now that math is in code).
- Phase 2: composite ≥ baseline; voice score ≥ baseline +0.5 (the prediction is that focused drafting lifts voice).
- Phase 3: PASS without human feedback on the same topic, OR judge revision instructions become substantially more specific.

---

## 5. Open questions for Bo

1. **Acceptable token cost increase?** Phase 2+3 roughly doubles the per-topic LLM spend (more, smaller calls + research fetches). Caching + tool-use trim it back, but not to baseline.
2. **Researcher's tool surface.** Web fetch via existing `citation-harvest.js`, or expand to Anthropic's native web search tool? Latter is cleaner but adds a dependency.
3. **Revision cap.** Currently 1 LLM-driven revision. Should that rise to 2 once revisions are surgical (Phase 2C)?
4. **Outliner ship gate.** Only ship Phase 3C if 3A+3B don't lift PASS rate enough — agreed?

---

## 6. Non-goals

- No changes to scanner, publisher, or social-poster wiring beyond moving the social-content *generation* out of drafter.
- No changes to the database schema.
- No changes to Slack message format or human-review UX.
- No model migration in this proposal (stays on `claude-sonnet-4-6` per current `.env.example`); Phase 4 is a candidate trigger for evaluating Opus 4.7 on Judge.
