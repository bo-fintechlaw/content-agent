import { VALID_SEGMENTS } from './constants.js';

export type SegmentId = 'financial_services' | 'tech_ai_legal';
export type SegmentChoice = SegmentId | 'both';

export function normalizeSegments(raw: unknown): SegmentId[] {
  if (typeof raw === 'string') {
    if (raw === 'both') return ['financial_services', 'tech_ai_legal'];
    if (VALID_SEGMENTS.has(raw)) return [raw as SegmentId];
  }
  if (Array.isArray(raw) && raw.length) {
    const segs = raw.map((s) => String(s)).filter((s) => VALID_SEGMENTS.has(s)) as SegmentId[];
    if (segs.length) return [...new Set(segs)];
  }
  return ['financial_services', 'tech_ai_legal'];
}

export function audienceForSegment(
  segment: string,
  config: { audienceFinancialServices: string; audienceTechAiLegal: string }
): string | null {
  if (segment === 'financial_services') return config.audienceFinancialServices || null;
  if (segment === 'tech_ai_legal') return config.audienceTechAiLegal || null;
  return null;
}
