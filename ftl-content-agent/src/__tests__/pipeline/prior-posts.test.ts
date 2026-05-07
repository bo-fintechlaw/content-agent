import { describe, expect, it, jest } from '@jest/globals';

const { findRelatedPriorPosts, recordPublishedPost } = await import(
  '../../pipeline/prior-posts.js'
);

function makeSupabaseStub(opts: {
  textSearchData?: any[];
  textSearchError?: { message: string } | null;
  upsertError?: { message: string } | null;
} = {}) {
  const upsertCalls: any[] = [];
  const textSearchCalls: any[] = [];
  const stub: any = {
    from: jest.fn<any>((_table: string) => {
      const chain: any = {};
      chain.select = jest.fn<any>(() => chain);
      chain.textSearch = jest.fn<any>((col: string, q: string, opts2: any) => {
        textSearchCalls.push({ col, q, opts2 });
        return chain;
      });
      chain.order = jest.fn<any>(() => chain);
      chain.limit = jest.fn<any>(() => chain);
      chain.neq = jest.fn<any>(() => chain);
      chain.then = (resolve: any) =>
        resolve({
          data: opts.textSearchData ?? [],
          error: opts.textSearchError ?? null,
        });
      chain.upsert = jest.fn<any>((row: any) => {
        upsertCalls.push(row);
        return Promise.resolve({ data: row, error: opts.upsertError ?? null });
      });
      return chain;
    }),
  };
  return { stub, upsertCalls, textSearchCalls };
}

describe('findRelatedPriorPosts', () => {
  it('returns [] when topic has no usable terms', async () => {
    const { stub } = makeSupabaseStub();
    const result = await findRelatedPriorPosts(stub, {
      topic: { title: 'a b c', summary: '' },
    });
    expect(result).toEqual([]);
  });

  it('returns [] when underlying query errors out', async () => {
    const { stub } = makeSupabaseStub({
      textSearchError: { message: 'fts unavailable' },
    });
    const result = await findRelatedPriorPosts(stub, {
      topic: {
        title: 'SEC enforcement against custodians',
        summary: 'Crypto custody compliance.',
      },
    });
    expect(result).toEqual([]);
  });

  it('passes a websearch tsquery built from significant tokens', async () => {
    const { stub, textSearchCalls } = makeSupabaseStub({ textSearchData: [] });
    await findRelatedPriorPosts(stub, {
      topic: {
        title: 'SEC enforcement against custodians',
        summary: 'Crypto custody compliance update.',
      },
    });
    expect(textSearchCalls).toHaveLength(1);
    const q = textSearchCalls[0].q as string;
    // Long content words present
    expect(q).toEqual(expect.stringContaining('enforcement'));
    expect(q).toEqual(expect.stringContaining('custodians'));
    expect(q).toEqual(expect.stringContaining('crypto'));
    // Stopwords stripped
    expect(q).not.toEqual(expect.stringContaining('against'));
    expect(q).not.toEqual(expect.stringContaining('with'));
  });

  it('returns the matching rows from the FTS query', async () => {
    const fixture = [
      {
        draft_id: 'd1',
        blog_title: 'SEC custody rules update',
        blog_slug: 'sec-custody',
        published_url: 'https://fintechlaw.ai/blog/sec-custody',
        first_paragraph: 'The SEC issued a new custody rule...',
        category: 'regulatory',
        published_at: '2026-04-12T00:00:00Z',
      },
    ];
    const { stub } = makeSupabaseStub({ textSearchData: fixture });
    const result = await findRelatedPriorPosts(stub, {
      topic: {
        title: 'SEC enforcement against custodians',
        summary: 'Crypto custody compliance.',
      },
    });
    expect(result).toEqual(fixture);
  });
});

describe('recordPublishedPost', () => {
  it('skips and reports when slug is missing (cannot build canonical URL)', async () => {
    const { stub, upsertCalls } = makeSupabaseStub();
    const result = await recordPublishedPost(stub, {
      draft: { id: 'd1', blog_title: 'X', blog_body: [] } as any,
      topic: { source_name: 'SEC', category: 'regulatory' },
      publishedAt: '2026-05-07T00:00:00Z',
    });
    expect(result).toEqual({ skipped: true, reason: 'missing_id_or_slug' });
    expect(upsertCalls).toHaveLength(0);
  });

  it('extracts the first non-trivial paragraph from blog_body', async () => {
    const { stub, upsertCalls } = makeSupabaseStub();
    await recordPublishedPost(stub, {
      draft: {
        id: 'd1',
        blog_title: 'Title',
        blog_slug: 'title',
        blog_body: [
          { title: 'Hook', body: 'Short.' },
          { title: 'Body', body: 'This is a longer paragraph that should qualify as the first paragraph used for FTS retrieval and snippets.' },
        ],
      } as any,
      topic: { source_name: 'SEC', category: 'regulatory' },
      publishedAt: '2026-05-07T00:00:00Z',
    });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].first_paragraph).toEqual(
      expect.stringContaining('longer paragraph')
    );
    expect(upsertCalls[0].published_url).toBe('https://fintechlaw.ai/blog/title');
  });

  it('respects appBaseUrl override', async () => {
    const { stub, upsertCalls } = makeSupabaseStub();
    await recordPublishedPost(stub, {
      draft: { id: 'd1', blog_title: 'T', blog_slug: 'foo', blog_body: [] } as any,
      topic: {},
      publishedAt: '2026-05-07T00:00:00Z',
      appBaseUrl: 'https://staging.fintechlaw.ai/',
    });
    expect(upsertCalls[0].published_url).toBe('https://staging.fintechlaw.ai/blog/foo');
  });

  it('reports recorded:false but does not throw on upsert error', async () => {
    const { stub } = makeSupabaseStub({ upsertError: { message: 'index conflict' } });
    const result = await recordPublishedPost(stub, {
      draft: { id: 'd1', blog_title: 'T', blog_slug: 's', blog_body: [] } as any,
      topic: {},
      publishedAt: '2026-05-07T00:00:00Z',
    });
    expect(result).toMatchObject({ recorded: false });
    expect(String(result.error)).toEqual(expect.stringContaining('index conflict'));
  });
});
