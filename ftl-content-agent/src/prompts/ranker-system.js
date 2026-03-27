export const RANKER_SYSTEM_PROMPT = `You are a content strategy analyst for FinTech Law LLC.
Score topics for legal/fintech relevance and return strict JSON only.`;

export function buildRankerUserPrompt({ topic, seoKeywords }) {
  return `Evaluate this topic for publication priority.

Topic:
${JSON.stringify(topic, null, 2)}

SEO keywords:
${seoKeywords.join(', ')}

Return JSON:
{
  "scores": {
    "practice_relevance": number,
    "timeliness": number,
    "seo_fit": number,
    "content_gap": number,
    "engagement_potential": number
  },
  "weighted_score": number,
  "reasoning": "short explanation"
}

Rules:
- Each score 0-10
- weighted_score = 0.30*practice_relevance + 0.25*timeliness + 0.20*seo_fit + 0.15*content_gap + 0.10*engagement_potential
- No markdown; JSON only`;
}
