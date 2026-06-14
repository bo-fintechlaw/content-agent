import { NEWSLETTER_ASSEMBLY_SYSTEM } from './prompts/newsletter-assembly-system.js';

/**
 * @param {import('@anthropic-ai/sdk').default} anthropic
 * @param {{ ANTHROPIC_MODEL: string }} config
 * @param {{ segment: string, posts: Array<Record<string, unknown>> }} ctx
 */
export async function assembleIssueJson(anthropic, config, ctx) {
  const title =
    ctx.segment === 'financial_services' ? 'The Financial Edge' : 'The Startup Solution';
  const issueDate = new Date().toISOString().slice(0, 10);
  const slug = `${ctx.segment === 'financial_services' ? 'financial-edge' : 'startup-solution'}-${issueDate.slice(0, 7)}`;

  const userMessage = JSON.stringify({
    segment: ctx.segment,
    title,
    issue_date: issueDate,
    slug,
    posts: ctx.posts,
    instructions:
      'Return ONLY valid JSON matching the Issue JSON schema. Include compliance_corner and action_items panels. Every feature must use published_url as blog_url.',
  });

  const response = await anthropic.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: NEWSLETTER_ASSEMBLY_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(jsonText);
}
