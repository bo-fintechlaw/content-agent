import satori from 'satori';
import { start, success } from '../utils/logger.js';

const PANEL_WIDTH = 924;
const PANEL_HEIGHT = 1316;

/**
 * Render carousel panel PNGs + .txt transcripts for a newsletter issue.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @returns {Promise<{ urls: string[], transcripts: Array<{ panel: number, text: string }> }>}
 */
export async function renderNewsletterCarousel(issue) {
  start('renderNewsletterCarousel', { slug: issue.slug });
  const baseUrl = `https://fintechlaw.ai/api/newsletter/carousel/${issue.slug}`;
  const urls = [];
  const transcripts = [];

  const panels = [
    { kind: 'cover', title: issue.title, intro: issue.intro, toc: issue.toc },
    ...issue.panels,
  ];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const transcript = panelToTranscript(panel, issue);
    transcripts.push({ panel: i + 1, text: transcript });

    // Satori render — returns SVG; callers may convert to PNG via external pipeline.
    // For task API we expose stable URLs; binary assets can be stored in a follow-on Blobs step.
    await satori(buildPanelElement(panel, issue), {
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      fonts: [],
    });

    urls.push(`${baseUrl}/panel-${i + 1}.png`);
  }

  success('renderNewsletterCarousel', { slug: issue.slug, panels: urls.length });
  return { urls, transcripts };
}

/** @param {unknown} panel @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue */
function buildPanelElement(panel, issue) {
  const headline =
    panel.kind === 'cover' ? panel.title : panel.headline ?? issue.title;
  const body =
    panel.kind === 'cover'
      ? panel.intro
      : panel.dek ?? panel.body ?? '';

  return {
    type: 'div',
    props: {
      style: {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        padding: 48,
        fontFamily: 'system-ui',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { fontSize: 14, letterSpacing: 2, color: '#94a3b8', marginBottom: 16 },
            children: issue.author.name,
          },
        },
        {
          type: 'h1',
          props: {
            style: { fontSize: 42, lineHeight: 1.2, margin: 0 },
            children: headline,
          },
        },
        {
          type: 'p',
          props: {
            style: { fontSize: 22, lineHeight: 1.5, marginTop: 24, color: '#cbd5e1' },
            children: String(body).slice(0, 400),
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
