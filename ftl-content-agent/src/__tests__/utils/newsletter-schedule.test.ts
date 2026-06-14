import {
  daysBetween,
  isNewsletterAssembleDay,
  segmentsDueOnDate,
} from '../../utils/newsletter-schedule.js';

describe('newsletter-schedule', () => {
  describe('The Financial Edge (financial_services)', () => {
    it('runs on anchor and every 14 days thereafter', () => {
      expect(isNewsletterAssembleDay('financial_services', '2026-06-18')).toBe(true);
      expect(isNewsletterAssembleDay('financial_services', '2026-07-02')).toBe(true);
      expect(isNewsletterAssembleDay('financial_services', '2026-07-16')).toBe(true);
    });

    it('skips before anchor and on off-week Thursdays', () => {
      expect(isNewsletterAssembleDay('financial_services', '2026-06-11')).toBe(false);
      expect(isNewsletterAssembleDay('financial_services', '2026-06-25')).toBe(false);
      expect(isNewsletterAssembleDay('financial_services', '2026-07-09')).toBe(false);
    });
  });

  describe('The Startup Solution (tech_ai_legal)', () => {
    it('runs on anchor and every 14 days thereafter', () => {
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-06-25')).toBe(true);
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-07-09')).toBe(true);
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-07-23')).toBe(true);
    });

    it('skips before anchor and on off-week Thursdays', () => {
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-06-18')).toBe(false);
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-07-02')).toBe(false);
      expect(isNewsletterAssembleDay('tech_ai_legal', '2026-07-16')).toBe(false);
    });
  });

  describe('segmentsDueOnDate', () => {
    it('returns only the segment due on a given Thursday', () => {
      expect(segmentsDueOnDate('2026-06-18')).toEqual(['financial_services']);
      expect(segmentsDueOnDate('2026-06-25')).toEqual(['tech_ai_legal']);
      expect(segmentsDueOnDate('2026-07-02')).toEqual(['financial_services']);
      expect(segmentsDueOnDate('2026-07-09')).toEqual(['tech_ai_legal']);
    });

    it('returns empty when no segment is scheduled', () => {
      expect(segmentsDueOnDate('2026-06-11')).toEqual([]);
    });
  });

  describe('daysBetween', () => {
    it('counts whole calendar days', () => {
      expect(daysBetween('2026-06-18', '2026-07-02')).toBe(14);
      expect(daysBetween('2026-06-18', '2026-06-18')).toBe(0);
      expect(daysBetween('2026-06-25', '2026-06-18')).toBe(-7);
    });
  });
});
