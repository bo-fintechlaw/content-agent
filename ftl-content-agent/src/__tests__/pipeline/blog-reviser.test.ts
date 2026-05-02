/**
 * Unit tests for blog-reviser.
 *
 * Focus: the verbatim guard. The reviser must not let the model "improve"
 * sections the feedback did not address — that was the entire point of
 * switching from full-redraft to targeted revision. Mocks Anthropic so we
 * can simulate well-behaved + misbehaving model outputs.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the Anthropic integration before importing the module under test.
// The mock returns whatever response the test sets via __setMockResponse.
let mockResponse: any = null;
function __setMockResponse(r: any) {
  mockResponse = r;
}

jest.unstable_mockModule('../../integrations/anthropic.js', () => ({
  createAnthropicClient: jest.fn<any>(() => ({})),
  promptJson: jest.fn<any>(() => Promise.resolve(mockResponse)),
}));

const { reviseBlogContent } = await import('../../pipeline/blog-reviser.js');

type DraftRow = Record<string, any>;

function buildDb(initial: DraftRow) {
  const drafts: DraftRow[] = [{ ...initial }];

  const supabase: any = {
    from: jest.fn<any>((table: string) => {
      if (table !== 'content_drafts') throw new Error(`unexpected table ${table}`);
      let filtered = [...drafts];
      const chain: any = {};

      chain.select = jest.fn<any>(() => chain);
      chain.eq = jest.fn<any>((col: string, val: any) => {
        filtered = filtered.filter((r) => r[col] === val);
        return chain;
      });
      chain.single = jest.fn<any>(() =>
        Promise.resolve({ data: filtered[0] ?? null, error: filtered[0] ? null : { message: 'not found' } })
      );
      chain.update = jest.fn<any>((updates: DraftRow) => {
        const updateChain: any = {};
        updateChain.eq = jest.fn<any>((col: string, val: any) => {
          for (const row of drafts) {
            if (row[col] === val) Object.assign(row, updates);
          }
          return Promise.resolve({ error: null });
        });
        return updateChain;
      });
      return chain;
    }),
  };

  return { supabase, drafts };
}

const config = { ANTHROPIC_API_KEY: 'test', ANTHROPIC_MODEL: 'claude-sonnet-4-6' };

beforeEach(() => {
  mockResponse = null;
});

describe('reviseBlogContent', () => {
  const baseDraft = {
    id: 'draft-1',
    topic_id: 'topic-1',
    blog_title: 'Original Title',
    blog_seo_title: 'Original SEO Title',
    blog_seo_description: 'Original SEO desc',
    blog_body: [
      { title: 'Intro', body: 'Original intro body.', has_background: false },
      { title: 'Analysis', body: 'Original analysis body.', has_background: false },
      { title: 'Closing', body: 'Original closing body.', has_background: false },
    ],
    judge_flags: ['old_flag'],
    revision_count: 0,
    judge_pass: true,
    judge_scores: { accuracy: { score: 8 } },
  };

  it('updates only the sections the model marked as changed', async () => {
    const { supabase, drafts } = buildDb(baseDraft);
    __setMockResponse({
      blog_title: 'Original Title',
      blog_seo_title: 'Original SEO Title',
      blog_seo_description: 'Original SEO desc',
      blog_body: [
        { title: 'Intro', body: 'Original intro body.', has_background: false },
        { title: 'Analysis', body: 'NEW ANALYSIS BODY.', has_background: false },
        { title: 'Closing', body: 'Original closing body.', has_background: false },
      ],
      change_summary: 'Updated analysis section per feedback.',
      changed_section_indices: [1],
    });

    const result = await reviseBlogContent(supabase, config, 'draft-1', 'fix the analysis');

    expect(result.changedSectionIndices).toEqual([1]);
    expect(drafts[0].blog_body[0].body).toBe('Original intro body.');
    expect(drafts[0].blog_body[1].body).toBe('NEW ANALYSIS BODY.');
    expect(drafts[0].blog_body[2].body).toBe('Original closing body.');
  });

  it('restores unchanged sections verbatim when the model rewrites them anyway', async () => {
    const { supabase, drafts } = buildDb(baseDraft);
    // Model misbehaves: it rewrites the intro even though it claims only
    // index 1 changed. The guard must restore the original intro.
    __setMockResponse({
      blog_title: 'Original Title',
      blog_seo_title: 'Original SEO Title',
      blog_seo_description: 'Original SEO desc',
      blog_body: [
        { title: 'Intro', body: 'MODEL REWROTE THIS WITHOUT PERMISSION', has_background: false },
        { title: 'Analysis', body: 'NEW ANALYSIS BODY.', has_background: false },
        { title: 'Closing', body: 'MODEL ALSO TIGHTENED THIS', has_background: false },
      ],
      change_summary: 'Updated analysis.',
      changed_section_indices: [1],
    });

    await reviseBlogContent(supabase, config, 'draft-1', 'fix the analysis');

    expect(drafts[0].blog_body[0].body).toBe('Original intro body.');
    expect(drafts[0].blog_body[1].body).toBe('NEW ANALYSIS BODY.');
    expect(drafts[0].blog_body[2].body).toBe('Original closing body.');
  });

  it('increments revision_count and clears judge_pass / judge_scores', async () => {
    const { supabase, drafts } = buildDb({ ...baseDraft, revision_count: 2 });
    __setMockResponse({
      blog_title: 'Original Title',
      blog_seo_title: 'Original SEO Title',
      blog_seo_description: 'Original SEO desc',
      blog_body: baseDraft.blog_body,
      change_summary: 'no-op',
      changed_section_indices: [],
    });

    await reviseBlogContent(supabase, config, 'draft-1', 'small tweak');

    expect(drafts[0].revision_count).toBe(3);
    expect(drafts[0].judge_pass).toBeNull();
    expect(drafts[0].judge_scores).toBeNull();
  });

  it('updates the title when the model returns a new one', async () => {
    const { supabase, drafts } = buildDb(baseDraft);
    __setMockResponse({
      blog_title: 'New Sharper Title',
      blog_seo_title: 'New Sharper SEO Title',
      blog_seo_description: 'Original SEO desc',
      blog_body: baseDraft.blog_body,
      change_summary: 'tightened title per feedback',
      changed_section_indices: [],
    });

    await reviseBlogContent(supabase, config, 'draft-1', 'sharper title please');

    expect(drafts[0].blog_title).toBe('New Sharper Title');
    expect(drafts[0].blog_seo_title).toBe('New Sharper SEO Title');
    expect(drafts[0].blog_seo_description).toBe('Original SEO desc');
  });

  it('falls back to the original blog_body when the model returns a non-array', async () => {
    const { supabase, drafts } = buildDb(baseDraft);
    __setMockResponse({
      blog_title: 'Original Title',
      blog_seo_title: 'Original SEO Title',
      blog_seo_description: 'Original SEO desc',
      blog_body: 'not an array',
      change_summary: 'malformed response',
      changed_section_indices: [],
    });

    await reviseBlogContent(supabase, config, 'draft-1', 'oops');

    expect(drafts[0].blog_body).toEqual(baseDraft.blog_body);
  });
});
