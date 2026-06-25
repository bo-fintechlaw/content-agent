import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FTL_BRAND, formatIssueDate, sectionLabelForKind } from '../emails/newsletter-brand-tokens.js';
import { ensureCarouselBucket, uploadCarouselPanel } from './newsletter-carousel-storage.js';
import { start, success, fail } from '../utils/logger.js';

const PANEL_WIDTH = 924;
const PANEL_HEIGHT = 1316;
const CONTENT_PAD = 56;
const brand = FTL_BRAND.colors;
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const PUBLIC_SITE = 'https://fintechlaw.ai';

/** @type {Promise<import('satori').FontOptions[]> | null} */
let carouselFontsPromise = null;

/** @type {Map<string, Promise<string | null>>} */
const imageCache = new Map();

/**
 * Load bundled brand fonts for satori (cached after first call).
 * @returns {Promise<import('satori').FontOptions[]>}
 */
export async function loadCarouselFonts() {
  if (!carouselFontsPromise) {
    carouselFontsPromise = (async () => {
      const readFont = (filename) => readFile(join(FONTS_DIR, filename));
      const [hanken400, hanken600, hanken700, playfair400, playfair700] = await Promise.all([
        readFont('HankenGrotesk-400.ttf'),
        readFont('HankenGrotesk-600.ttf'),
        readFont('HankenGrotesk-700.ttf'),
        readFont('PlayfairDisplay-400.ttf'),
        readFont('PlayfairDisplay-700.ttf'),
      ]);

      return [
        { name: 'Hanken Grotesk', data: hanken400, weight: 400, style: 'normal' },
        { name: 'Hanken Grotesk', data: hanken600, weight: 600, style: 'normal' },
        { name: 'Hanken Grotesk', data: hanken700, weight: 700, style: 'normal' },
        { name: 'Playfair Display', data: playfair400, weight: 400, style: 'normal' },
        { name: 'Playfair Display', data: playfair700, weight: 700, style: 'normal' },
      ];
    })();
  }
  return carouselFontsPromise;
}

/**
 * Fetch a remote image and return a data URI for satori (cached).
 * @param {string | undefined | null} url
 * @returns {Promise<string | null>}
 */
export async function loadCarouselImage(url) {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return null;
  if (imageCache.has(trimmed)) return imageCache.get(trimmed);

  const task = (async () => {
    try {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  })();

  imageCache.set(trimmed, task);
  return task;
}

/**
 * Render carousel panel PNGs + transcripts; upload to Supabase storage when client provided.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ supabase?: import('@supabase/supabase-js').SupabaseClient, archiveUrl?: string }} [opts]
 */
export async function renderNewsletterCarousel(issue, opts = {}) {
  start('renderNewsletterCarousel', { slug: issue.slug });
  const { supabase } = opts;
  if (supabase) await ensureCarouselBucket(supabase);

  const fonts = await loadCarouselFonts();
  const archiveUrl = opts.archiveUrl ?? `${PUBLIC_SITE}/newsletters/${issue.slug}`;
  const ctx = { archiveUrl };
  const urls = [];
  const transcripts = [];
  const panels = [
    { kind: 'cover', title: issue.title, intro: issue.intro, toc: issue.toc },
    ...issue.panels,
  ];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelIndex = i + 1;
    transcripts.push({ panel: panelIndex, text: panelToTranscript(panel, issue, ctx) });

    const element = await buildPanelElement(panel, issue, ctx);
    const svg = await satori(element, {
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      fonts,
    });

    const pngBuffer = svgToPng(svg);

    if (supabase) {
      try {
        const url = await uploadCarouselPanel(supabase, {
          slug: issue.slug,
          panelIndex,
          pngBuffer,
        });
        urls.push(url);
        continue;
      } catch (uploadErr) {
        fail('renderNewsletterCarousel:upload', uploadErr, { slug: issue.slug, panelIndex });
      }
    }

    urls.push(`${PUBLIC_SITE}/api/newsletter/carousel/${issue.slug}/panel-${panelIndex}.png`);
  }

  success('renderNewsletterCarousel', { slug: issue.slug, panels: urls.length });
  return { urls, transcripts };
}

/** @param {string} svg */
function svgToPng(svg) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: PANEL_WIDTH } });
  return Buffer.from(resvg.render().asPng());
}

/**
 * @param {unknown} panel
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ archiveUrl: string }} ctx
 */
async function buildPanelElement(panel, issue, ctx) {
  if (panel.kind === 'cover') return buildCoverPanel(panel, issue, ctx);
  if (panel.kind === 'feature') return buildFeaturePanel(panel, issue, ctx);
  if (panel.kind === 'compliance_corner') return buildCompliancePanel(panel, issue, ctx);
  if (panel.kind === 'action_items') return buildActionItemsPanel(panel, issue, ctx);
  if (panel.kind === 'spotlight') return buildSpotlightPanel(panel, issue, ctx);
  return buildTextPanel('SPOTLIGHT', panel.headline ?? issue.title, panel.dek ?? '', ctx);
}

/** @param {unknown} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
async function buildCoverPanel(panel, issue, ctx) {
  const logoSrc = await loadCarouselImage(FTL_BRAND.logoUrl);
  const dateStr = formatIssueDate(issue.issue_date);
  const tocItems = (panel.toc ?? issue.toc ?? []).slice(0, 5);

  const children = [
  ...(logoSrc
    ? [
        {
          type: 'img',
          props: {
            src: logoSrc,
            width: 72,
            height: 72,
            style: { borderRadius: 12, marginBottom: 28 },
          },
        },
      ]
    : []),
    textBlock({
      fontSize: 13,
      letterSpacing: 3,
      color: brand.pink,
      marginBottom: 12,
      textTransform: 'uppercase',
      fontFamily: FTL_BRAND.fonts.ui,
      children: 'NEWSLETTER',
    }),
    textBlock({
      fontSize: 15,
      color: 'rgba(255,255,255,0.72)',
      marginBottom: 20,
      fontFamily: FTL_BRAND.fonts.body,
      children: dateStr,
    }),
    textBlock({
      fontSize: 44,
      lineHeight: 1.12,
      fontWeight: 700,
      fontFamily: FTL_BRAND.fonts.heading,
      marginBottom: 24,
      children: truncate(panel.title ?? issue.title, 100),
    }),
    textBlock({
      fontSize: 20,
      lineHeight: 1.5,
      color: 'rgba(255,255,255,0.88)',
      fontFamily: FTL_BRAND.fonts.body,
      marginBottom: 28,
      children: truncate(panel.intro ?? issue.intro, 280),
    }),
    textBlock({
      fontSize: 12,
      letterSpacing: 2,
      color: brand.pink,
      marginBottom: 14,
      textTransform: 'uppercase',
      fontFamily: FTL_BRAND.fonts.ui,
      children: 'In This Edition',
    }),
    ...tocItems.map((item) =>
      textBlock({
        fontSize: 18,
        lineHeight: 1.45,
        color: 'rgba(255,255,255,0.9)',
        fontFamily: FTL_BRAND.fonts.body,
        marginBottom: 10,
        children: `• ${truncate(item, 70)}`,
      })
    ),
    buildCtaBar('Read the full issue →', ctx.archiveUrl),
    buildFooterBar(),
  ];

  return panelShell(children);
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'feature' }} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
async function buildFeaturePanel(panel, issue, ctx) {
  const section = sectionLabelForKind('feature');
  const heroSrc = await loadCarouselImage(panel.hero_image_url);
  const stats = (panel.stats ?? []).slice(0, 2);
  const takeaway = panel.action_list?.[0];

  const children = [
    buildSectionHeader(section, panel.kicker),
    ...(heroSrc
      ? [
          {
            type: 'img',
            props: {
              src: heroSrc,
              width: PANEL_WIDTH - CONTENT_PAD * 2,
              height: 320,
              style: {
                objectFit: 'cover',
                borderRadius: 8,
                marginBottom: 24,
              },
            },
          },
        ]
      : []),
    textBlock({
      fontSize: 38,
      lineHeight: 1.15,
      fontWeight: 700,
      fontFamily: FTL_BRAND.fonts.heading,
      marginBottom: 16,
      children: truncate(panel.headline, 90),
    }),
    textBlock({
      fontSize: 20,
      lineHeight: 1.45,
      color: 'rgba(255,255,255,0.86)',
      fontFamily: FTL_BRAND.fonts.body,
      marginBottom: stats.length || panel.pull_quote ? 20 : 0,
      children: truncate(panel.dek, 200),
    }),
    ...(stats.length ? [buildStatsRow(stats)] : []),
    ...(panel.pull_quote ? [buildQuoteBlock(panel.pull_quote)] : []),
    ...(takeaway
      ? [
          textBlock({
            fontSize: 16,
            lineHeight: 1.45,
            color: 'rgba(255,255,255,0.82)',
            fontFamily: FTL_BRAND.fonts.body,
            marginTop: 16,
            children: `→ ${truncate(takeaway, 90)}`,
          }),
        ]
      : []),
    buildCtaBar('Read the full analysis →', panel.blog_url),
    buildFooterBar(),
  ];

  return panelShell(children);
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'compliance_corner' }} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
async function buildCompliancePanel(panel, issue, ctx) {
  const section = sectionLabelForKind('compliance_corner');
  const deadlines = (panel.deadlines ?? []).slice(0, 3);
  const litigation = (panel.litigation_watch ?? []).slice(0, 2);

  const children = [
    buildSectionHeader(section, panel.kicker),
    textBlock({
      fontSize: 36,
      lineHeight: 1.15,
      fontWeight: 700,
      fontFamily: FTL_BRAND.fonts.heading,
      marginBottom: 14,
      children: truncate(panel.headline, 90),
    }),
    textBlock({
      fontSize: 20,
      lineHeight: 1.45,
      color: 'rgba(255,255,255,0.86)',
      fontFamily: FTL_BRAND.fonts.body,
      marginBottom: 20,
      children: truncate(panel.dek, 180),
    }),
    ...(deadlines.length
      ? [
          textBlock({
            fontSize: 12,
            letterSpacing: 2,
            color: brand.pink,
            marginBottom: 12,
            textTransform: 'uppercase',
            fontFamily: FTL_BRAND.fonts.ui,
            children: 'Deadlines',
          }),
          ...deadlines.map((d) =>
            textBlock({
              fontSize: 17,
              lineHeight: 1.4,
              fontFamily: FTL_BRAND.fonts.body,
              marginBottom: 10,
              children: `${d.date}: ${truncate(d.requirement, 80)}`,
            })
          ),
        ]
      : []),
    ...(litigation.length
      ? [
          textBlock({
            fontSize: 12,
            letterSpacing: 2,
            color: brand.pink,
            marginTop: 12,
            marginBottom: 12,
            textTransform: 'uppercase',
            fontFamily: FTL_BRAND.fonts.ui,
            children: 'Litigation Watch',
          }),
          ...litigation.map((item) =>
            textBlock({
              fontSize: 17,
              lineHeight: 1.4,
              fontFamily: FTL_BRAND.fonts.body,
              marginBottom: 8,
              children: `• ${truncate(item, 90)}`,
            })
          ),
        ]
      : []),
    buildCtaBar('View compliance details →', ctx.archiveUrl),
    buildFooterBar(),
  ];

  return panelShell(children);
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'action_items' }} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
async function buildActionItemsPanel(panel, issue, ctx) {
  const section = sectionLabelForKind('action_items');
  const groups = (panel.groups ?? []).slice(0, 2);
  const itemLines = groups.flatMap((g) =>
    (g.items ?? []).slice(0, 2).map((item) => `${g.firm_type}: ${item}`)
  ).slice(0, 4);

  const children = [
    buildSectionHeader(section, panel.kicker),
    textBlock({
      fontSize: 36,
      lineHeight: 1.15,
      fontWeight: 700,
      fontFamily: FTL_BRAND.fonts.heading,
      marginBottom: 14,
      children: truncate(panel.headline, 90),
    }),
    textBlock({
      fontSize: 20,
      lineHeight: 1.45,
      color: 'rgba(255,255,255,0.86)',
      fontFamily: FTL_BRAND.fonts.body,
      marginBottom: 20,
      children: truncate(panel.dek, 180),
    }),
    ...itemLines.map((line) =>
      textBlock({
        fontSize: 18,
        lineHeight: 1.45,
        fontFamily: FTL_BRAND.fonts.body,
        marginBottom: 10,
        children: `• ${truncate(line, 95)}`,
      })
    ),
    buildCtaBar('Schedule a consultation →', panel.consultation_url),
    buildFooterBar(),
  ];

  return panelShell(children);
}

/** @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']['panels'][number] & { kind: 'spotlight' }} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
async function buildSpotlightPanel(panel, issue, ctx) {
  return buildTextPanel(
    sectionLabelForKind('spotlight'),
    panel.headline,
    panel.body || panel.dek,
    ctx,
    panel.kicker
  );
}

/** @param {string} section @param {string} headline @param {string} body @param {{ archiveUrl: string }} ctx @param {string} [kicker] */
async function buildTextPanel(section, headline, body, ctx, kicker) {
  const children = [
    buildSectionHeader(section, kicker),
    textBlock({
      fontSize: 36,
      lineHeight: 1.15,
      fontWeight: 700,
      fontFamily: FTL_BRAND.fonts.heading,
      marginBottom: 14,
      children: truncate(headline, 90),
    }),
    textBlock({
      fontSize: 20,
      lineHeight: 1.5,
      color: 'rgba(255,255,255,0.88)',
      fontFamily: FTL_BRAND.fonts.body,
      marginBottom: 24,
      children: truncate(body, 420),
    }),
    buildCtaBar('Read the newsletter →', ctx.archiveUrl),
    buildFooterBar(),
  ];
  return panelShell(children);
}

/** @param {unknown[]} children */
function panelShell(children) {
  return {
    type: 'div',
    props: {
      style: {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(160deg, ${brand.purple} 0%, ${brand.purpleDark} 55%, ${brand.black} 100%)`,
        color: brand.white,
        padding: CONTENT_PAD,
        fontFamily: FTL_BRAND.fonts.body,
      },
      children,
    },
  };
}

/** @param {string} section @param {string} [kicker] */
function buildSectionHeader(section, kicker) {
  const children = [
    textBlock({
      fontSize: 13,
      letterSpacing: 3,
      color: brand.pink,
      marginBottom: kicker ? 8 : 20,
      textTransform: 'uppercase',
      fontFamily: FTL_BRAND.fonts.ui,
      children: section,
    }),
  ];
  if (kicker) {
    children.push(
      textBlock({
        fontSize: 12,
        letterSpacing: 1,
        color: 'rgba(255,255,255,0.65)',
        marginBottom: 20,
        textTransform: 'uppercase',
        fontFamily: FTL_BRAND.fonts.ui,
        children: truncate(kicker, 60),
      })
    );
  }
  return {
    type: 'div',
    props: { style: { display: 'flex', flexDirection: 'column' }, children },
  };
}

/** @param {{ value: string, label: string }[]} stats */
function buildStatsRow(stats) {
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', gap: 16, marginBottom: 20 },
      children: stats.map((stat) => ({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 18px',
            border: `1px solid rgba(255,255,255,0.2)`,
            borderRadius: 6,
            minWidth: 120,
          },
          children: [
            textBlock({
              fontSize: 28,
              fontWeight: 700,
              fontFamily: FTL_BRAND.fonts.heading,
              children: stat.value,
            }),
            textBlock({
              fontSize: 11,
              letterSpacing: 1,
              color: 'rgba(255,255,255,0.7)',
              textTransform: 'uppercase',
              fontFamily: FTL_BRAND.fonts.ui,
              marginTop: 4,
              children: truncate(stat.label, 40),
            }),
          ],
        },
      })),
    },
  };
}

/** @param {string} quote */
function buildQuoteBlock(quote) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 20px',
        borderLeft: `4px solid ${brand.pink}`,
        background: 'rgba(255,255,255,0.08)',
        marginTop: 8,
        marginBottom: 8,
      },
      children: [
        textBlock({
          fontSize: 11,
          letterSpacing: 2,
          color: 'rgba(255,255,255,0.65)',
          textTransform: 'uppercase',
          fontFamily: FTL_BRAND.fonts.ui,
          marginBottom: 8,
          children: 'Why it matters',
        }),
        textBlock({
          fontSize: 19,
          lineHeight: 1.45,
          fontStyle: 'italic',
          fontFamily: FTL_BRAND.fonts.body,
          children: `"${truncate(quote, 160)}"`,
        }),
      ],
    },
  };
}

/** @param {string} label @param {string} url */
function buildCtaBar(label, url) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginTop: 'auto',
        paddingTop: 28,
        borderTop: `3px solid ${brand.pink}`,
        gap: 8,
      },
      children: [
        textBlock({
          fontSize: 18,
          fontWeight: 700,
          color: brand.white,
          fontFamily: FTL_BRAND.fonts.ui,
          children: label,
        }),
        textBlock({
          fontSize: 15,
          color: brand.pink,
          fontFamily: FTL_BRAND.fonts.body,
          children: displayUrl(url),
        }),
      ],
    },
  };
}

function buildFooterBar() {
  return textBlock({
    fontSize: 14,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: FTL_BRAND.fonts.ui,
    marginTop: 16,
    children: 'fintechlaw.ai',
  });
}

/** @param {Record<string, unknown>} style */
function textBlock(style) {
  const { children, ...rest } = style;
  return {
    type: 'div',
    props: {
      style: { display: 'flex', ...rest },
      children: String(children ?? ''),
    },
  };
}

/** @param {string} s @param {number} max */
function truncate(s, max) {
  const text = String(s ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** @param {string} url */
function displayUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return String(url ?? '');
  }
}

/** @param {unknown} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue @param {{ archiveUrl: string }} ctx */
function panelToTranscript(panel, issue, ctx) {
  if (panel.kind === 'cover') {
    return `${issue.title}\n${issue.intro}\n${issue.toc.join('\n')}\n${ctx.archiveUrl}`;
  }
  if (panel.kind === 'feature') {
    return `${panel.headline}\n${panel.dek}\n${panel.pull_quote}\n${panel.blog_url}`;
  }
  if (panel.kind === 'action_items') {
    return `${panel.headline}\n${panel.dek}\n${panel.consultation_url}`;
  }
  if (panel.kind === 'compliance_corner') {
    return `${panel.headline}\n${panel.dek}\n${ctx.archiveUrl}`;
  }
  if (panel.kind === 'spotlight') {
    return `${panel.headline}\n${panel.body ?? panel.dek}\n${ctx.archiveUrl}`;
  }
  return JSON.stringify(panel);
}
