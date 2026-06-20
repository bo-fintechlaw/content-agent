#!/usr/bin/env node
/**
 * POST senior-dev PR review output to the shared CTO learning pipeline (prod only).
 *
 * Usage:
 *   node scripts/record-pr-review-learning.mjs [path/to/review-output.json]
 *
 * Env:
 *   CTO_AGENT_BASE_URL — must be CTO prod (set in workflow env, not a per-repo override)
 *   CTO_AGENT_TASK_SECRET — repo secret
 */
import fs from 'node:fs';

const inputPath = process.argv[2] ?? '.github/senior-dev/review-output.json';
const CTO_PROD_BASE_URL = process.env.CTO_PROD_BASE_URL ?? 'https://ftl-cto-agent-production.up.railway.app'; // pragma: allowlist secret
const baseUrl = String(process.env.CTO_AGENT_BASE_URL ?? CTO_PROD_BASE_URL).replace(
  /\/+$/,
  ''
);
const secret = process.env.CTO_AGENT_TASK_SECRET ?? '';

function fail(message) {
  console.error(`record-pr-review-learning: ${message}`);
  process.exit(1);
}

if (!secret) {
  console.log('record-pr-review-learning: CTO_AGENT_TASK_SECRET not set — skipping');
  process.exit(0);
}

if (!baseUrl) fail('CTO_AGENT_BASE_URL is required');
if (!fs.existsSync(inputPath)) {
  console.log(`record-pr-review-learning: missing review output (${inputPath}) — skipping`);
  process.exit(0);
}

const reviewPayload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const endpoint = process.env.CTO_LEARNING_ENDPOINT ?? '/api/learnings/pr-review';

const res = await fetch(`${baseUrl}${endpoint}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CTO-Task-Token': secret,
  },
  body: JSON.stringify({
    source: 'claude-senior-dev-review',
    repo: reviewPayload.repo,
    prNumber: reviewPayload.prNumber,
    baseRef: reviewPayload.baseRef,
    headRef: reviewPayload.headRef,
    reviewedAt: reviewPayload.reviewedAt,
    model: reviewPayload.model,
    verdict: reviewPayload.review?.verdict,
    summary: reviewPayload.review?.summary,
    findings: reviewPayload.review?.findings ?? [],
  }),
});

if (!res.ok) {
  const text = await res.text();
  fail(`CTO learning POST ${res.status}: ${text}`);
}

console.log(`record-pr-review-learning: ok → ${baseUrl}${endpoint}`);
