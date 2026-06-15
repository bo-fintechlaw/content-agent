import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FTL_BRAND } from '../emails/newsletter-brand-tokens.js';
import { ensureCarouselBucket, uploadCarouselPanel } from './newsletter-carousel-storage.js';
import { start, success, fail } from '../utils/logger.js';

const PANEL_WIDTH = 924;
const PANEL_HEIGHT = 1316;
const brand = FTL_BRAND.colors;

/**
 * Render carousel panel PNGs + transcripts; upload to Supabase storage when client provided.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {{ supabase?: import('@supabase/supabase-js').SupabaseClient }} [opts]
 */
export async function renderNewsletterCarousel(issue, opts = {}) {
  start('renderNewsletterCarousel', { slug: issue.slug });
  const { supabase } = opts;
  if (supabase) await ensureCarouselBucket(supabase);

  const urls = [];
  const transcripts = [];
  const panels = [
    { kind: 'cover', title: issue.title, intro: issue.intro, toc: issue.toc },
    ...issue.panels,
  ];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelIndex = i + 1;
    transcripts.push({ panel: panelIndex, text: panelToTranscript(panel, issue) });

    const svg = await satori(buildPanelElement(panel, issue), {
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      fonts: [],
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

    urls.push(
      `https://fintechlaw.ai/api/newsletter/carousel/${issue.slug}/panel-${panelIndex}.png`
    );
  }

  success('renderNewsletterCarousel', { slug: issue.slug, panels: urls.length });
  return { urls, transcripts };
}

/** @param {string} svg */
function svgToPng(svg) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: PANEL_WIDTH } });
  return Buffer.from(resvg.render().asPng());
}

/** @param {unknown} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function buildPanelElement(panel, issue) {
  const headline =
    panel.kind === 'cover' ? panel.title : panel.headline ?? issue.title;
  const body =
    panel.kind === 'cover'
      ? panel.intro
      : panel.dek ?? panel.body ?? '';

  const sectionLabel =
    panel.kind === 'cover'
      ? issue.title
      : panel.kind === 'feature'
        ? 'FROM THE BLOG'
        : panel.kind === 'compliance_corner'
          ? 'COMPLIANCE CORNER'
          : panel.kind === 'action_items'
            ? 'YOUR MOVE'
            : 'SPOTLIGHT';

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
        padding: 56,
        fontFamily: 'system-ui, sans-serif',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontSize: 13,
              letterSpacing: 3,
              color: brand.pink,
              marginBottom: 20,
              textTransform: 'uppercase',
            },
            children: sectionLabel,
          },
        },
        {
          type: 'div',
          props: {
            style: { fontSize: 14, letterSpacing: 1, color: 'rgba(255,255,255,0.7)', marginBottom: 12 },
            children: issue.author.name,
          },
        },
        {
          type: 'h1',
          props: {
            style: { fontSize: 46, lineHeight: 1.15, margin: 0, fontWeight: 700 },
            children: String(headline).slice(0, 120),
          },
        },
        {
          type: 'p',
          props: {
            style: { fontSize: 22, lineHeight: 1.45, marginTop: 28, color: 'rgba(255,255,255,0.88)' },
            children: String(body).slice(0, 380),
          },
        },
        {
          type: 'div',
          props: {
            style: {
              marginTop: 'auto',
              paddingTop: 32,
              borderTop: `3px solid ${brand.pink}`,
              fontSize: 16,
              letterSpacing: 2,
              color: 'rgba(255,255,255,0.65)',
            },
            children: 'fintechlaw.ai',
          },
        },
      ],
    },
  };
}

/** @param {unknown} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function panelToTranscript(panel, issue) {
  if (panel.kind === 'cover') {
    return `${issue.title}\n${issue.intro}\n${issue.toc.join('\n')}`;
  }
  if (panel.kind === 'feature') {
    return `${panel.headline}\n${panel.dek}\n${panel.pull_quote}\n${panel.blog_url}`;
  }
  return JSON.stringify(panel);
}
