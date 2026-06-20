#!/usr/bin/env node
/**
 * Senior dev PR review runner (GitHub Actions).
 * Reads diff + prompts from .github/senior-dev/, writes review-output.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const systemPrompt = [
  fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf8'),
  '\n\n---\n\n',
  fs.readFileSync(path.join(__dirname, 'rubric.md'), 'utf8'),
].join('');

const baseRef = process.env.GITHUB_BASE_REF || 'main';
const headRef = process.env.GITHUB_HEAD_REF || 'HEAD';
const diff = execSync(`git diff origin/${baseRef}...${headRef}`, {
  cwd: repoRoot,
  maxBuffer: config.maxDiffBytes,
}).toString('utf8');

const prMeta = {
  repo: process.env.GITHUB_REPOSITORY,
  prNumber: process.env.GITHUB_PR_NUMBER,
  baseRef,
  headRef,
  title: process.env.GITHUB_PR_TITLE ?? '',
};

const userMessage = [
  `Repository: ${prMeta.repo}`,
  `PR #${prMeta.prNumber ?? '?'}: ${prMeta.title}`,
  `Base: ${baseRef}  Head: ${headRef}`,
  '',
  'Diff:',
  '```diff',
  diff.slice(0, config.maxDiffBytes),
  '```',
].join('\n');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await client.messages.create({
  model: config.reviewModel,
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});

const text = response.content
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('\n');

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('Senior dev review did not return JSON');
  process.exit(1);
}

const review = JSON.parse(jsonMatch[0]);
const outputPath = path.join(__dirname, 'review-output.json');
const payload = {
  ...prMeta,
  reviewedAt: new Date().toISOString(),
  model: config.reviewModel,
  review,
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

const body = [
  `## Senior dev review (${review.verdict})`,
  '',
  review.summary,
  '',
  ...(review.findings?.length
    ? ['### Findings', '', ...review.findings.map((f) => `- **${f.severity}** \`${f.path}\` — ${f.title}: ${f.detail}`)]
    : ['No findings.']),
].join('\n');

if (process.env.GITHUB_TOKEN && prMeta.prNumber) {
  const [owner, repo] = prMeta.repo.split('/');
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prMeta.prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });
}

if (review.verdict === 'request_changes') {
  process.exit(1);
}

console.log('Senior dev review: approve');
