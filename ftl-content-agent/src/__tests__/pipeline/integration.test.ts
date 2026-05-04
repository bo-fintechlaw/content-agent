/**
 * Integration test: full happy-path pipeline flow.
 *
 * Mocks all external services (Supabase, Anthropic, Slack, Sanity, LinkedIn, X)
 * and verifies that a topic flows through: scan → rank → draft → judge → publish → social.
 *
 * Each stage is tested as a real function call with mocked dependencies,
 * verifying status transitions and data hand-offs between stages.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ---------- shared state: simulated database ----------
type DbRow = Record<string, any>;
let dbTopics: DbRow[] = [];
let dbDrafts: DbRow[] = [];
let dbAnalytics: DbRow[] = [];
let idCounter = 1;

function uuid() {
  return `test-uuid-${idCounter++}`;
}

function buildSupabaseMock() {
  const chainable = (data: any, error: any = null) => {
    const chain: Record<string, any> = {};
    const methods = [
      'select', 'eq', 'in', 'is', 'not', 'order', 'limit',
      'maybeSingle', 'single',
    ];
    for (const m of methods) {
      if (m === 'single' || m === 'maybeSingle') {
        chain[m] = jest.fn<any>(() => {
          const rows = typeof data === 'function' ? data() : data;
          const row = Array.isArray(rows) ? rows[0] ?? null : rows;
          return Promise.resolve({ data: row, error });
        });
      } else {
        chain[m] = jest.fn<any>(() => chain);
      }
    }
    // Terminal: when chain is awaited without single/maybeSingle
    chain.then = (resolve: any) => {
      const rows = typeof data === 'function' ? data() : data;
      return resolve({ data: rows, error });
    };
    return chain;
  };

  return {
    from: jest.fn<any>((table: string) => {
      const store = table === 'content_topics' ? dbTopics
        : table === 'content_drafts' ? dbDrafts
        : table === 'content_analytics' ? dbAnalytics
        : [];

      return {
        select: jest.fn<any>((_cols?: string) => {
          const filterChain: Record<string, any> = {};
          let filtered = [...store];

          filterChain.eq = jest.fn<any>((col: string, val: any) => {
            filtered = filtered.filter((r) => r[col] === val);
            return filterChain;
          });
          filterChain.is = jest.fn<any>((col: string, val: any) => {
            // Match SQL IS NULL semantics: both null and undefined match null
            filtered = filtered.filter((r) => val === null ? r[col] == null : r[col] === val);
            return filterChain;
          });
          filterChain.not = jest.fn<any>((col: string, _op: string, _val: any) => {
            filtered = filtered.filter((r) => r[col] != null);
            return filterChain;
          });
          filterChain.in = jest.fn<any>((col: string, vals: any[]) => {
            filtered = filtered.filter((r) => vals.includes(r[col]));
            return filterChain;
          });
          filterChain.order = jest.fn<any>(() => filterChain);
          filterChain.limit = jest.fn<any>(() => filterChain);
          filterChain.maybeSingle = jest.fn<any>(() =>
            Promise.resolve({ data: filtered[0] ?? null, error: null })
          );
          filterChain.single = jest.fn<any>(() =>
            Promise.resolve({ data: filtered[0] ?? null, error: filtered[0] ? null : { message: 'not found' } })
          );
          // Resolve as array when awaited
          filterChain.then = (resolve: any) => resolve({ data: filtered, error: null });
          return filterChain;
        }),

        insert: jest.fn<any>((row: any) => {
          const newRow = { id: uuid(), created_at: new Date().toISOString(), ...row };
          store.push(newRow);
          return {
            select: jest.fn<any>(() => ({
              single: jest.fn<any>(() =>
                Promise.resolve({ data: newRow, error: null })
              ),
              then: (resolve: any) => resolve({ data: [newRow], error: null }),
            })),
            then: (resolve: any) => resolve({ data: newRow, error: null }),
            catch: jest.fn<any>(() => Promise.resolve()),
          };
        }),

        update: jest.fn<any>((updates: any) => {
          return {
            eq: jest.fn<any>((col: string, val: any) => {
              const row = store.find((r) => r[col] === val);
              if (row) Object.assign(row, updates);
              return Promise.resolve({ data: row, error: null });
            }),
          };
        }),
      };
    }),
  };
}

// ---------- mock Anthropic responses ----------
const rankerResponse = {
  scores: { practice_relevance: 9, timeliness: 8, seo_fit: 7, content_gap: 6, engagement_potential: 8 },
  weighted_score: 8.0,
  reasoning: 'Highly relevant SEC enforcement topic',
};

const drafterResponse = {
  blog_title: 'SEC Hedge Clause Crackdown: Advisory Agreement Lessons',
  blog_slug: 'sec-hedge-clause-crackdown',
  blog_body: [
    { title: 'The Enforcement Action', body: 'The SEC just issued a $150,000 wake-up call.', has_background: false },
    { title: 'Why This Matters', body: 'Advisory agreements carry real regulatory risk.', has_background: false },
    { title: 'Key Takeaways', body: '**Review your hedge clauses.** The SEC is watching.', has_background: true },
  ],
  blog_seo_title: 'SEC Hedge Clause Enforcement Action',
  blog_seo_description: 'What the FamilyWealth settlement means for your advisory agreements.',
  blog_seo_keywords: 'SEC enforcement, hedge clause, advisory agreement',
  blog_category: 'enforcement',
  blog_tags: 'sec, enforcement, advisory',
  image_prompt: 'Legal gavel resting on financial documents',
  linkedin_post: 'The SEC just sent a $150K message about hedge clauses. Here is what it means for your firm.',
  x_post: 'SEC fines advisory firm $150K over boilerplate hedge clauses. Your agreement might be next.',
  x_thread: [
    'SEC just fined FamilyWealth Advisory $150K.',
    'The issue? Standard hedge clauses the SEC considers misleading.',
    'Read the full analysis on our blog.',
  ],
};

const judgeResponse = {
  scores: {
    accuracy: { score: 9, rationale: 'Citations verified' },
    engagement: { score: 8, rationale: 'Strong opening hook' },
    seo: { score: 8, rationale: 'Keywords well placed' },
    voice: { score: 9, rationale: 'Matches Bo voice exactly' },
    structure: { score: 8, rationale: 'Follows mandatory blueprint' },
  },
  composite: 8.5,
  verdict: 'PASS',
  revision_instructions: [],
  strengths: ['Excellent regulatory analysis', 'Strong voice match'],
  flags: [],
};

// ---------- mock modules ----------
jest.unstable_mockModule('../../utils/logger.js', () => ({
  start: jest.fn(),
  success: jest.fn(),
  fail: jest.fn(),
}));

jest.unstable_mockModule('../../integrations/anthropic.js', () => ({
  createAnthropicClient: jest.fn(() => ({})),
  promptJson: jest.fn<any>(),
}));

jest.unstable_mockModule('../../integrations/slack.js', () => ({
  createSlackClient: jest.fn(() => ({})),
  sendReviewMessage: jest.fn<any>(() => Promise.resolve({ ts: 'slack-ts-123' })),
  sendStatusMessage: jest.fn<any>(() => Promise.resolve({ ok: true, ts: 'slack-ts-789' })),
}));

jest.unstable_mockModule('../../integrations/sanity.js', () => ({
  createSanityClient: jest.fn(() => ({})),
  createAndPublishBlogFromDraft: jest.fn<any>(() =>
    Promise.resolve({ docId: 'sanity-doc-123', published: true })
  ),
}));

jest.unstable_mockModule('../../integrations/linkedin.js', () => ({
  postLinkedInUgc: jest.fn<any>(() => Promise.resolve({ id: 'li-post-123' })),
}));

jest.unstable_mockModule('../../integrations/x.js', () => ({
  postXTweet: jest.fn<any>(() => Promise.resolve({ id: 'x-tweet-123' })),
}));

jest.unstable_mockModule('axios', () => ({
  default: { post: jest.fn<any>(() => Promise.resolve({ status: 200 })) },
}));

// Citation subagent + URL harvester are mocked so the integration test does not
// rely on network access (fetchOneCitationUrl uses native fetch) and does not
// consume promptJson mocks for citation verification — those mocks are reserved
// for the ranker / drafter / judge calls under test.
jest.unstable_mockModule('../../pipeline/citation-harvest.js', () => ({
  extractHttpUrlsFromDraft: jest.fn<any>(() => []),
  fetchAllCitationPreviews: jest.fn<any>(() => Promise.resolve([])),
  fetchOneCitationUrl: jest.fn<any>(() =>
    Promise.resolve({
      url: '',
      finalUrl: '',
      ok: false,
      status: 0,
      contentType: '',
      title: null,
      textPreview: '',
      error: 'mocked',
    })
  ),
}));

jest.unstable_mockModule('../../pipeline/citation-subagent.js', () => ({
  runCitationVerificationSubagent: jest.fn<any>(() =>
    Promise.resolve({
      assessments: [],
      subagent_flags: [],
      subagent_summary: 'mocked: no http(s) URLs in draft to verify.',
    })
  ),
}));

jest.unstable_mockModule('../../pipeline/claim-verification-subagent.js', () => ({
  runClaimVerificationSubagent: jest.fn<any>(() =>
    Promise.resolve({
      assessments: [],
      subagent_flags: [],
      subagent_summary: 'mocked: claim verification skipped in integration test.',
      contradicted_count: 0,
    })
  ),
}));

// ---------- import pipeline modules after mocks ----------
const { runTopicRanking } = await import('../../pipeline/ranker.js');
const { runDrafting } = await import('../../pipeline/drafter.js');
const { runJudging } = await import('../../pipeline/judge.js');
const { runDraftAndJudge } = await import('../../pipeline/production.js');
const { publishDraftToSanity } = await import('../../pipeline/publisher.js');
const { runSocialPosting } = await import('../../pipeline/social-poster.js');
const { promptJson } = await import('../../integrations/anthropic.js');
const { sendReviewMessage } = await import('../../integrations/slack.js');
const { createAndPublishBlogFromDraft } = await import('../../integrations/sanity.js');
const { postLinkedInUgc } = await import('../../integrations/linkedin.js');
const { postXTweet } = await import('../../integrations/x.js');

const config = {
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_CHANNEL_ID: 'C-TEST',
  SANITY_PROJECT_ID: 'test-proj',
  SANITY_DATASET: 'production',
  SANITY_API_TOKEN: 'test-token',
  SANITY_SCHEMA_ID: 'blogPost',
  LINKEDIN_ACCESS_TOKEN: 'li-token',
  LINKEDIN_PERSON_URN: 'urn:li:person:test',
  X_API_KEY: 'x-key',
  X_API_SECRET: 'x-secret',
  X_ACCESS_TOKEN: 'x-token',
  X_ACCESS_TOKEN_SECRET: 'x-token-secret',
  ENABLE_X_POSTING: true,
  PREJUDGE_ENFORCE_VERIFIED_CITATIONS: false,
  NETLIFY_BUILD_HOOK: 'https://api.netlify.com/build_hooks/test',
  ORCHESTRATION_MAX_SOCIAL: 3,
};

describe('Pipeline Integration — Happy Path', () => {
  let supabase: any;

  beforeEach(() => {
    dbTopics = [];
    dbDrafts = [];
    dbAnalytics = [];
    idCounter = 1;
    jest.clearAllMocks();
  });

  it('flows a topic from ranking through social posting', async () => {
    // --- Setup: insert a pending topic (simulating scanner output) ---
    const topicId = uuid();
    dbTopics.push({
      id: topicId,
      title: 'SEC Settles Hedge Clause Enforcement Against FamilyWealth',
      summary: 'SEC fined FamilyWealth Advisory Group $150,000 for misleading hedge clauses.',
      category: 'regulatory',
      relevance_score: null,
      status: 'pending',
      suggested_by: 'scanner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    supabase = buildSupabaseMock();

    // --- Stage 2: Ranking ---
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(rankerResponse);

    const rankResult = await runTopicRanking(supabase, config);
    expect(rankResult.processed).toBe(1);
    expect(rankResult.ranked).toBe(1);

    // Verify topic was updated to ranked.
    // relevance_score is now computed in code from per-criterion scores
    // (verdict.js): 0.30*9 + 0.25*8 + 0.20*7 + 0.15*6 + 0.10*8 = 7.8
    const rankedTopic = dbTopics.find((t) => t.id === topicId);
    expect(rankedTopic?.status).toBe('ranked');
    expect(rankedTopic?.relevance_score).toBe(7.8);

    // --- Stage 3: Drafting ---
    supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(drafterResponse);

    const draftResult = await runDrafting(supabase, config);
    expect(draftResult.drafted).toBe(true);

    // Verify draft was inserted
    expect(dbDrafts).toHaveLength(1);
    expect(dbDrafts[0].blog_title).toBe(drafterResponse.blog_title);
    expect(dbDrafts[0].blog_body).toHaveLength(3);

    // Verify topic status advanced to judging
    const judgingTopic = dbTopics.find((t) => t.id === topicId);
    expect(judgingTopic?.status).toBe('judging');

    // --- Stage 4: Judging (PASS) ---
    supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(judgeResponse);

    const judgeResult = await runJudging(supabase, config);
    expect(judgeResult.judged).toBe(true);
    expect(judgeResult.verdict).toBe('PASS');
    expect(judgeResult.pass).toBe(true);

    // Verify topic moved to review
    const reviewTopic = dbTopics.find((t) => t.id === topicId);
    expect(reviewTopic?.status).toBe('review');

    // Verify Slack was notified
    expect(sendReviewMessage).toHaveBeenCalledTimes(1);

    // --- Stage 5: Simulate Slack approval (set status to approved) ---
    const approvedTopic = dbTopics.find((t) => t.id === topicId);
    if (approvedTopic) approvedTopic.status = 'approved';

    // --- Stage 6: Publishing ---
    supabase = buildSupabaseMock();
    const draftId = dbDrafts[0].id;

    const pubResult = await publishDraftToSanity(supabase, config, draftId);
    expect(pubResult.docId).toBe('sanity-doc-123');

    // Verify draft got sanity_document_id
    expect(dbDrafts[0].sanity_document_id).toBe('sanity-doc-123');
    expect(dbDrafts[0].published_at).toBeDefined();

    // Verify topic moved to published
    const publishedTopic = dbTopics.find((t) => t.id === topicId);
    expect(publishedTopic?.status).toBe('published');

    // Verify Sanity was called
    expect(createAndPublishBlogFromDraft).toHaveBeenCalledTimes(1);

    // --- Stage 7: Social posting ---
    // Simulate social approval
    dbDrafts[0].social_approved = true;
    supabase = buildSupabaseMock();

    const socialResult = await runSocialPosting(supabase, config);
    expect(socialResult.postedLinkedIn).toBe(1);
    expect(socialResult.postedX).toBe(1);

    // Verify LinkedIn and X were called
    expect(postLinkedInUgc).toHaveBeenCalledTimes(1);
    expect(postXTweet).toHaveBeenCalled(); // main tweet + thread replies

    // Verify draft was updated with post IDs
    expect(dbDrafts[0].linkedin_post_id).toBe('li-post-123');
    expect(dbDrafts[0].x_post_id).toBe('x-tweet-123');
  });
});

describe('Pipeline Integration — Revision Loop', () => {
  let supabase: any;

  beforeEach(() => {
    dbTopics = [];
    dbDrafts = [];
    dbAnalytics = [];
    idCounter = 1;
    jest.clearAllMocks();
  });

  it('sends draft back for revision when judge says REVISE', async () => {
    const topicId = uuid();
    dbTopics.push({
      id: topicId,
      title: 'Test Revision Topic',
      summary: 'Testing the revision loop.',
      category: 'regulatory',
      status: 'judging',
      created_at: new Date().toISOString(),
    });

    const draftId = uuid();
    dbDrafts.push({
      id: draftId,
      topic_id: topicId,
      blog_title: 'Original Draft',
      blog_body: [{ title: 'Section', body: 'Weak content.', has_background: false }],
      blog_slug: 'test-revision',
      blog_seo_title: 'Test',
      blog_seo_description: 'Test',
      blog_seo_keywords: 'test',
      blog_category: 'regulatory',
      blog_tags: 'test',
      linkedin_post: 'Post',
      x_post: 'Tweet',
      x_thread: [],
      image_prompt: '',
      judge_pass: null,
      judge_scores: null,
      judge_flags: null,
      revision_count: 0,
      created_at: new Date().toISOString(),
    });

    const reviseResponse = {
      scores: {
        accuracy: { score: 7, rationale: 'OK' },
        engagement: { score: 5, rationale: 'Weak opening' },
        seo: { score: 6, rationale: 'Missing keywords' },
        voice: { score: 6, rationale: 'Too generic' },
        structure: { score: 7, rationale: 'Decent' },
      },
      composite: 6.2,
      verdict: 'REVISE',
      revision_instructions: ['Strengthen the opening with a specific news hook', 'Add keyword to first paragraph'],
      strengths: ['Good regulatory analysis'],
      flags: ['weak_hook', 'missing_seo_keyword'],
    };

    supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(reviseResponse);

    const result = await runJudging(supabase, config);

    // Should NOT be judged (sent back for revision)
    expect(result.judged).toBe(false);
    expect(result.revised).toBe(true);
    expect(result.verdict).toBe('REVISE');

    // Topic should be in revision state
    const topic = dbTopics.find((t) => t.id === topicId);
    expect(topic?.status).toBe('revision');

    // Draft should have revision_count incremented and judge_flags set
    const draft = dbDrafts.find((d) => d.id === draftId);
    expect(draft?.revision_count).toBe(1);
    expect(draft?.judge_pass).toBe(false);
    expect(draft?.judge_flags).toContain('weak_hook');

    // Slack should NOT have been called (revision, not review)
    expect(sendReviewMessage).not.toHaveBeenCalled();
  });

  it('sends exhausted revision to Slack instead of looping again', async () => {
    const topicId = uuid();
    dbTopics.push({
      id: topicId,
      title: 'Exhausted Revision Topic',
      summary: 'Already revised once.',
      category: 'regulatory',
      status: 'judging',
      created_at: new Date().toISOString(),
    });

    const draftId = uuid();
    dbDrafts.push({
      id: draftId,
      topic_id: topicId,
      blog_title: 'Revised Draft',
      blog_body: [{ title: 'Section', body: 'Better content.' }],
      judge_pass: null,
      revision_count: 1, // Already revised once — at the limit
      created_at: new Date().toISOString(),
    });

    const reviseAgainResponse = {
      scores: {
        accuracy: 7, engagement: 6, seo: 6, voice: 6, structure: 7,
      },
      composite: 6.5,
      verdict: 'REVISE',
      revision_instructions: ['Still needs work'],
      strengths: ['Improved'],
      flags: ['still_weak'],
    };

    supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(reviseAgainResponse);

    const result = await runJudging(supabase, config);

    // Should be judged (sent to Slack) since revision limit is exhausted
    expect(result.judged).toBe(true);

    // Topic should go to review (not revision)
    const topic = dbTopics.find((t) => t.id === topicId);
    expect(topic?.status).toBe('review');

    // Slack should have been called
    expect(sendReviewMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Pipeline Integration — Manual Topic Bypass', () => {
  beforeEach(() => {
    dbTopics = [];
    dbDrafts = [];
    idCounter = 1;
    jest.clearAllMocks();
  });

  it('manually suggested topics bypass ranking with score 10', async () => {
    const topicId = uuid();
    dbTopics.push({
      id: topicId,
      title: 'Manual Topic from Bo',
      summary: 'Manually suggested article.',
      category: 'ai_legal_tech',
      status: 'pending',
      suggested_by: 'manual',
      created_at: new Date().toISOString(),
    });

    const supabase = buildSupabaseMock();
    const result = await runTopicRanking(supabase, config);

    expect(result.bypassedManual).toBe(1);
    expect(result.ranked).toBe(1);

    const topic = dbTopics.find((t) => t.id === topicId);
    expect(topic?.status).toBe('ranked');
    expect(topic?.relevance_score).toBe(10.0);

    // Claude should NOT have been called for manual topics
    expect(promptJson).not.toHaveBeenCalled();
  });
});

describe('Pipeline Integration — topicId / draftId overrides', () => {
  beforeEach(() => {
    dbTopics = [];
    dbDrafts = [];
    idCounter = 1;
    jest.clearAllMocks();
  });

  it('runDrafting with topicId targets that ranked topic, not the highest score in the queue', async () => {
    const lowId = uuid();
    const highId = uuid();
    const now = new Date().toISOString();
    dbTopics.push(
      {
        id: lowId,
        title: 'Lower score topic',
        summary: 's',
        category: 'regulatory',
        relevance_score: 3,
        status: 'ranked',
        created_at: now,
        updated_at: now,
      },
      {
        id: highId,
        title: 'Higher score topic',
        summary: 's2',
        category: 'regulatory',
        relevance_score: 99,
        status: 'ranked',
        created_at: now,
        updated_at: now,
      }
    );

    const supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(drafterResponse);

    const draftResult = await runDrafting(supabase, config, { topicId: lowId });
    expect(draftResult.drafted).toBe(true);
    expect(dbDrafts[0].topic_id).toBe(lowId);
  });

  it('runJudging with draftId judges that draft even if another unjudged draft is older', async () => {
    const topicA = uuid();
    const topicB = uuid();
    const olderDraft = uuid();
    const newerDraft = uuid();
    const now = new Date().toISOString();
    dbTopics.push(
      { id: topicA, title: 'A', summary: 's', category: 'regulatory', status: 'judging', created_at: now },
      { id: topicB, title: 'B', summary: 's', category: 'regulatory', status: 'judging', created_at: now }
    );
    dbDrafts.push(
      {
        id: olderDraft,
        topic_id: topicA,
        blog_title: 'Old',
        blog_body: [],
        judge_pass: null,
        created_at: '2020-01-01T00:00:00.000Z',
      },
      {
        id: newerDraft,
        topic_id: topicB,
        blog_title: 'Newer',
        blog_body: [],
        judge_pass: null,
        created_at: '2025-01-01T00:00:00.000Z',
      }
    );

    const supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>).mockResolvedValueOnce(judgeResponse);

    const result = await runJudging(supabase, config, { draftId: newerDraft });
    expect(result.judged).toBe(true);
    expect(result.draftId).toBe(newerDraft);
    const oldD = dbDrafts.find((d) => d.id === olderDraft);
    expect(oldD?.judge_pass).toBeNull();
  });

  it('runDrafting skips scheduled ranked topic below minRelevanceScore', async () => {
    const t = uuid();
    const now = new Date().toISOString();
    dbTopics.push({
      id: t,
      title: 'Low score',
      summary: 's',
      category: 'regulatory',
      relevance_score: 6.0,
      status: 'ranked',
      created_at: now,
      updated_at: now,
    });
    const supabase = buildSupabaseMock();
    const r = await runDrafting(supabase, config, { minRelevanceScore: 7.0 });
    expect(r.drafted).toBe(false);
    expect(r.reason).toBe('below_minimum_relevance_score');
    expect(promptJson).not.toHaveBeenCalled();
  });

  it('runDraftAndJudge runs drafter+judger with matching draft for scheduled min score', async () => {
    const t = uuid();
    const now = new Date().toISOString();
    dbTopics.push({
      id: t,
      title: 'Ok score',
      summary: 's',
      category: 'regulatory',
      relevance_score: 8.0,
      status: 'ranked',
      created_at: now,
      updated_at: now,
    });
    const supabase = buildSupabaseMock();
    (promptJson as jest.MockedFunction<any>)
      .mockResolvedValueOnce(drafterResponse)
      .mockResolvedValueOnce(judgeResponse);

    const r = await runDraftAndJudge(supabase, config, {
      minRelevanceScore: 7.0,
      runKind: 'scheduled',
    });
    expect(r.draft?.drafted).toBe(true);
    expect(r.judge?.judged).toBe(true);
  });
});
