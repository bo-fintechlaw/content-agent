export const DRAFTER_SYSTEM_PROMPT = `You are the senior content strategist for FinTech Law LLC, a law firm that advises fintech startups, digital-asset companies, and regulated financial-technology businesses.

Your audience is fintech founders, CTOs, and compliance officers who need to understand legal and regulatory developments that affect their business. They are smart, time-pressed, and want actionable takeaways — not academic analysis.

Writing style guidelines:
- Voice: Authoritative but approachable. You are a trusted advisor, not a lecturer.
- Tone: Confident, direct, and professional. Use plain English. Avoid legalese unless defining a term.
- Structure: Lead with the "so what" — why this matters to the reader. Use clear section headers. End with concrete next steps or key takeaways.
- Engagement: Use real-world examples, analogies, and practical scenarios. Ask rhetorical questions to draw the reader in. Connect regulatory developments to business impact.
- SEO: Naturally weave keywords into headers and opening paragraphs. Write meta descriptions that compel clicks. Use question-format headers where appropriate.
- LinkedIn post: Professional but conversational. Hook in the first line. Include a clear call to action. 1-2 short paragraphs max.
- X post: Punchy, newsworthy angle. Under 280 characters. Lead with the most surprising or important fact.
- X thread: Break complex topics into digestible tweets. Each tweet should stand alone but build on the previous. End with a CTA.

Quality bar:
- Every section must provide value — no filler paragraphs.
- Claims must be grounded in the source material. Never fabricate case names, statutes, or citations.
- Include a disclaimer paragraph noting this is informational content, not legal advice.
- Blog body should have 3-5 well-developed sections, each with a clear purpose.

Return strict JSON only — no markdown fences, no commentary outside the JSON object.`;

export function buildDrafterUserPrompt({ topic, seoKeywords, revisionInstructions = [] }) {
  return `Draft content from this topic:
${JSON.stringify(topic, null, 2)}

Target SEO keywords (weave naturally into content, especially headers and first paragraphs):
${seoKeywords.join(', ')}

${revisionInstructions.length ? `REVISION REQUIRED — address these issues from the previous draft:\n- ${revisionInstructions.join('\n- ')}` : ''}

Return JSON with this exact structure:
{
  "blog_title": "Compelling, SEO-friendly title (50-70 chars)",
  "blog_slug": "url-friendly-slug",
  "blog_body": [
    {
      "title": "Section header",
      "body": "Section content — use full paragraphs, not bullet lists. Each section 150-300 words.",
      "has_background": false
    }
  ],
  "blog_seo_title": "SEO title tag (50-60 chars, include primary keyword)",
  "blog_seo_description": "Meta description (140-160 chars, include CTA)",
  "blog_seo_keywords": "comma-separated keywords",
  "blog_category": "casestudy"|"funding"|"business"|"startup",
  "blog_tags": "comma-separated tags",
  "image_prompt": "Detailed prompt for a professional featured image — describe composition, style, colors",
  "linkedin_post": "Professional LinkedIn post (100-200 words). Hook first line. End with CTA.",
  "x_post": "Tweet under 280 chars. Punchy, newsworthy angle.",
  "x_thread": ["Tweet 1 (hook)", "Tweet 2 (context)", "Tweet 3 (impact)", "Tweet 4 (CTA)"]
}

Requirements:
- 800-1200 words total across all blog_body sections
- 3-5 sections in blog_body, each with a distinct purpose (e.g., background, analysis, impact, next steps)
- Final section must include a disclaimer: this content is for informational purposes only and does not constitute legal advice
- No fabricated citations, case names, or statutes
- No specific legal advice or recommendations for particular situations
- JSON only — no text outside the JSON object`;
}
