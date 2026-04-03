# CLAUDE.md — Content Agent Development Guide

## Project Overview

Autonomous content pipeline for FinTech Law (fintechlaw.ai). Scans RSS feeds, drafts blog posts via Claude, judges quality, publishes to Sanity CMS, and posts to social media.

**Architecture spec:** `ftl-content-agent/FTL_Content_Agent_Architecture_Spec_v1_0.md`

## Quick Start

```bash
cd ftl-content-agent
npm install
cp .env.example .env   # fill in credentials
npm start              # production
npm run dev            # development (hot reload)
```

## Testing

### Run all tests before pushing

```bash
npm test                # run full test suite (vitest)
npm run test:watch      # watch mode during development
npm run test:simulate   # offline pipeline simulation with realistic mock data
```

### Test structure

- Unit tests live alongside source files: `src/**/*.test.js`
- Simulation scripts live in `scripts/`:
  - `simulate-pipeline-offline.mjs` — exercises portable text conversion with realistic draft data (no API key needed)
  - `simulate-pipeline.mjs` — full API-based simulation (requires `ANTHROPIC_API_KEY`)

### Writing tests

- Use [Vitest](https://vitest.dev/) (ESM-native, compatible with the project's `"type": "module"`)
- Name test files `*.test.js` next to the module they test
- Test formatting changes against realistic blog content (bold-lead takeaways, inline links, bulleted/numbered lists)
- When modifying `portable-text.js`, run both `npm test` and `npm run test:simulate` to verify

### What to test

- **portable-text.js** — inline formatting (bold, italic, links), list detection, edge cases (empty input, nested formatting)
- **Prompt changes** — verify output structure by running `simulate-pipeline.mjs` with an API key, or review the offline simulation
- **New pipeline stages** — add unit tests for pure functions; integration tests can use the API endpoints

## Key Files

| Area | Files |
|------|-------|
| Content generation | `src/prompts/drafter-system.js`, `src/pipeline/drafter.js` |
| Quality judging | `src/prompts/judge-system.js`, `src/pipeline/judge.js` |
| Publishing | `src/utils/portable-text.js`, `src/integrations/sanity.js`, `src/pipeline/publisher.js` |
| Social media | `src/pipeline/social-poster.js`, `src/pipeline/social-reviser.js` |
| Configuration | `src/config/env.js`, `src/config/sources.js`, `src/config/seo-keywords.js` |

## Development Workflow

1. Make changes on a feature branch
2. Run `npm test` — all tests must pass
3. Run `npm run test:simulate` — verify pipeline behavior with realistic data
4. Commit with clear message describing the "why"
5. Push and create PR

## Content Pipeline Stages

```
Scanner → Ranker → Drafter → Judge → Slack Review → Publisher → Social Poster
```

Each stage has a manual trigger endpoint: `GET /api/{stage}-now`

## Formatting Rules (Portable Text)

The `markdownToPortableText()` function in `src/utils/portable-text.js` converts markdown to Sanity Portable Text. It supports:

- `**bold**` → `marks: ['strong']`
- `*italic*` → `marks: ['em']`
- `[text](url)` → `markDefs` with `_type: 'link'`
- `- item` / `* item` → `listItem: 'bullet'`
- `1. item` → `listItem: 'number'`
- Nested combinations (bold inside links, links inside bold)

When modifying this function, update both the unit tests and the simulation script.

## Judge Scoring

6 weighted criteria: accuracy (1.5x), engagement (1.0x), SEO (0.75x), voice (1.25x), structure (1.0x), formatting (0.5x).

Composite formula: `(accuracy*1.5 + engagement*1.0 + seo*0.75 + voice*1.25 + structure*1.0 + formatting*0.5) / 6.0`

PASS >= 8.0 (no individual < 6). REVISE >= 5.0. REJECT < 5.0 or accuracy < 5.
