import { createAnthropicClient } from '../integrations/anthropic.js';
import { fail, start, success } from '../utils/logger.js';

const LINKEDIN_SYSTEM = `You write LinkedIn posts for FinTech Law LLC newsletter issues.
Tone: authoritative, practical, no hype or superlatives. No contractions.
Format: hook line, 3-5 bullet points with → arrows, blank line, CTA with archive URL, 3-5 hashtags on final line.
Return plain text only — no JSON, no markdown fences.`;

/**
 * Generate LinkedIn post copy for a published newsletter issue.
 * @param {Record<string, unknown>} config
 * @param {{
 *   issue: import('../schemas/newsletter.js').IssueJsonSchema['_output'],
 *   archiveUrl: string,
 *   feedback?: string,
 * }} input
 */
export async function generateNewsletterLinkedInPost(config, input) {
  start('generateNewsletterLinkedInPost', { slug: input.issue.slug });

  if (!config.ANTHROPIC_API_KEY) {
    const fallback = buildFallbackPost(input.issue, input.archiveUrl);
    return fallback;
  }

  const features = input.issue.panels.filter((p) => p.kind === 'feature');
  const featureSummary = features
    .map((f) => `- ${f.headline}: ${f.dek}`)
    .join('\n');

  const userMessage = `Write a LinkedIn post promoting this newsletter issue.

Title: ${input.issue.title}
Issue date: ${input.issue.issue_date}
Intro: ${input.issue.intro}
Feature panels:
${featureSummary}

Archive URL (include in CTA): ${input.archiveUrl}
${input.feedback ? `\nRevision feedback from reviewer:\n${input.feedback}` : ''}`;

  try {
    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);
    const resp = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 800,
      temperature: 0.4,
      system: LINKEDIN_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text =
      resp.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ?? '';
    const trimmed = String(text).trim();
    if (!trimmed) return buildFallbackPost(input.issue, input.archiveUrl);
    success('generateNewsletterLinkedInPost', { slug: input.issue.slug });
    return trimmed;
  } catch (err) {
    fail('generateNewsletterLinkedInPost', err, { slug: input.issue.slug });
    return buildFallbackPost(input.issue, input.archiveUrl);
  }
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {string} archiveUrl */
function buildFallbackPost(issue, archiveUrl) {
  const firstFeature = issue.panels.find((p) => p.kind === 'feature');
  const hook = firstFeature?.headline ?? issue.title;
  return `${issue.title} is out.\n\n→ ${hook}\n\nRead the full issue → ${archiveUrl}\n\n#FinTechLaw #RegulatoryCompliance #LegalTech`;
}
