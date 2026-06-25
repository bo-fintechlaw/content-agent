import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  loadCarouselImage,
  renderNewsletterCarousel,
} from '../../integrations/newsletter-carousel.js';
import { NEWSLETTER_AUTHOR_TITLE } from '../../schemas/newsletter.js';
import {
  NEWSLETTER_FOOTER_DISCLAIMER,
  NEWSLETTER_PHYSICAL_ADDRESS,
  NEWSLETTER_SUBSCRIBE_URL,
} from '../../constants/newsletter-brand.js';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MINIMAL_ISSUE = {
  title: 'The Financial Edge — Carousel Font Test',
  segment: 'financial_services' as const,
  issue_date: '2026-06-23',
  slug: 'financial-edge-carousel-font-test',
  author: { name: 'Bo Howell', title: NEWSLETTER_AUTHOR_TITLE },
  intro:
    'This is a minimal newsletter fixture used to verify satori carousel rendering with bundled brand fonts.',
  toc: ['Feature one', 'Compliance corner', 'Action items', 'Spotlight'],
  panels: [
    {
      kind: 'feature' as const,
      section_no: 1,
      kicker: 'ANALYSIS · 01',
      headline: 'Carousel panel headline one',
      dek: 'Supporting dek text for the first feature panel.',
      stats: [{ value: '12', label: 'SEC actions' }],
      pull_quote: 'A pull quote for transcript coverage.',
      action_list: ['Review controls'],
      blog_url: 'https://fintechlaw.ai/blog/example-a',
      hero_image_url: 'https://example.test/hero-a.png',
    },
    {
      kind: 'feature' as const,
      section_no: 2,
      kicker: 'ANALYSIS · 02',
      headline: 'Carousel panel headline two',
      dek: 'Supporting dek text for the second feature panel.',
      stats: [],
      pull_quote: 'Second pull quote.',
      action_list: ['Document substantiation'],
      blog_url: 'https://fintechlaw.ai/blog/example-b',
    },
    {
      kind: 'compliance_corner' as const,
      section_no: 3,
      kicker: 'COMPLIANCE CORNER',
      headline: 'Upcoming deadlines',
      dek: 'Key compliance dates for registered advisers.',
      deadlines: [{ date: 'Jul 1', requirement: 'Annual amendment window' }],
      litigation_watch: ['Sample litigation item'],
    },
    {
      kind: 'action_items' as const,
      section_no: 4,
      kicker: 'YOUR MOVE',
      headline: 'Action items by firm type',
      dek: 'Concrete next steps for compliance teams.',
      groups: [{ firm_type: 'RIA', items: ['Audit marketing substantiation files'] }],
      consultation_url: 'https://fintechlaw.ai/contact',
    },
    {
      kind: 'spotlight' as const,
      section_no: 5,
      kicker: 'SPOTLIGHT',
      headline: 'Spotlight headline',
      dek: 'Spotlight dek for carousel rendering.',
      body: 'Spotlight body copy for the final carousel panel.',
    },
  ],
  footer: {
    disclaimer: NEWSLETTER_FOOTER_DISCLAIMER,
    subscribe_url: NEWSLETTER_SUBSCRIBE_URL,
    physical_address: NEWSLETTER_PHYSICAL_ADDRESS,
  },
};

describe('renderNewsletterCarousel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('apple-touch-icon') || url.includes('hero')) {
        return new Response(ONE_BY_ONE_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns carousel URLs for a minimal issue without Supabase', async () => {
    const { urls, transcripts } = await renderNewsletterCarousel(MINIMAL_ISSUE);

    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(transcripts.length).toBe(urls.length);
    expect(urls[0]).toContain(MINIMAL_ISSUE.slug);
    expect(urls[0]).toContain('panel-1.png');
  });

  it('includes archive and blog links in transcripts', async () => {
    const { transcripts } = await renderNewsletterCarousel(MINIMAL_ISSUE, {
      archiveUrl: 'https://fintechlaw.ai/newsletters/test-slug',
    });

    expect(transcripts[0].text).toContain('https://fintechlaw.ai/newsletters/test-slug');
    expect(transcripts[1].text).toContain('https://fintechlaw.ai/blog/example-a');
    expect(transcripts[4].text).toContain('https://fintechlaw.ai/contact');
  });

  it('uploads panels when Supabase client is provided', async () => {
    const uploaded: string[] = [];
    const mockSupabase = {
      storage: {
        listBuckets: async () => ({ data: [{ name: 'newsletter-carousel' }] }),
        from: () => ({
          upload: async (path: string) => {
            uploaded.push(path);
            return { error: null };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://example.test/storage/${path}` },
          }),
        }),
      },
    };

    const { urls } = await renderNewsletterCarousel(MINIMAL_ISSUE, {
      supabase: mockSupabase as never,
    });

    expect(urls.length).toBe(6);
    expect(uploaded.length).toBe(6);
    expect(urls.every((url) => url.startsWith('https://example.test/storage/'))).toBe(true);
  });
});

describe('loadCarouselImage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns a data URI for a fetchable image', async () => {
    global.fetch = jest.fn(async () =>
      new Response(ONE_BY_ONE_PNG, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    ) as typeof fetch;

    const dataUri = await loadCarouselImage('https://example.test/hero.png');
    expect(dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null when image fetch fails', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 404 })) as typeof fetch;

    const dataUri = await loadCarouselImage('https://example.test/missing.png');
    expect(dataUri).toBeNull();
  });
});
