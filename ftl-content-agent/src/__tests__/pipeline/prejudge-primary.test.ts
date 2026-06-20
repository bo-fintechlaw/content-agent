import { describe, expect, it } from '@jest/globals';
import {
  inferPrimarySourceUrlFromDraft,
  isRecoverablePrejudgeBlockedDraft,
} from '../../pipeline/prejudge-primary.js';

describe('inferPrimarySourceUrlFromDraft', () => {
  it('returns first independent URL when topic has no source_url', () => {
    const url = inferPrimarySourceUrlFromDraft({
      blog_body: [
        {
          body: 'See [PR Newswire](https://www.prnewswire.com/news-releases/example-302792661.html) and [FinTech Law](https://fintechlaw.ai/contact).',
        },
      ],
    });
    expect(url).toBe('https://www.prnewswire.com/news-releases/example-302792661.html');
  });

  it('returns empty when only self-citations exist', () => {
    const url = inferPrimarySourceUrlFromDraft({
      blog_body: [{ body: 'Learn more at https://fintechlaw.ai/contact' }],
    });
    expect(url).toBe('');
  });
});

describe('isRecoverablePrejudgeBlockedDraft', () => {
  it('detects prejudge-only missing primary blocks', () => {
    expect(
      isRecoverablePrejudgeBlockedDraft({
        judge_pass: false,
        judge_scores: null,
        judge_flags: ['prejudge:missing_primary_source_url'],
      })
    ).toBe(true);
  });

  it('rejects judged drafts and mixed prejudge failures', () => {
    expect(
      isRecoverablePrejudgeBlockedDraft({
        judge_pass: false,
        judge_scores: { accuracy: 5 },
        judge_flags: ['prejudge:missing_primary_source_url'],
      })
    ).toBe(false);
    expect(
      isRecoverablePrejudgeBlockedDraft({
        judge_pass: false,
        judge_scores: null,
        judge_flags: ['prejudge:missing_verified_secondary_citation'],
      })
    ).toBe(false);
  });
});
