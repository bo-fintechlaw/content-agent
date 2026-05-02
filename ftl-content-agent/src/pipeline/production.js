import { runDrafting } from './drafter.js';
import { runJudging } from './judge.js';
import { createAnthropicClient } from '../integrations/anthropic.js';
import { createSanityClient } from '../integrations/sanity.js';
import { generateAndUploadImage } from '../integrations/image-generator.js';
import { createSlackClient, sendReviewMessage } from '../integrations/slack.js';
import {
  extractHttpUrlsFromDraft,
  fetchAllCitationPreviews,
} from './citation-harvest.js';
import { runCitationVerificationSubagent } from './citation-subagent.js';
import {
  computeJudgeComposite,
  normalizeJudgeScores as normalizeJudgeScoresFromVerdict,
} from './verdict.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * Draft, then immediately judge the new draft. Used by the 7 AM scheduled job
 * and by `GET /api/start-production?topicId=` (on-demand).
 *
 * - **Scheduled** (no `topicId`): same queue as `runDrafting` (revision first, then best
 *   ranked) with an optional `minRelevanceScore` floor for **ranked** rows only.
 * - **On-demand** (`topicId` set): drafts that topic (ranked or revision) if no unjudged
 *   draft exists, then judges that draft. Ignores the relevance floor.
 *
 * Publish + social are **not** run here: Slack approval, then the 15m orchestrator (or
 * `publish-now` / social) handles the rest.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{
 *   topicId?: string,
 *   minRelevanceScore?: number,
 *   runKind?: 'scheduled' | 'on_demand',
 * } | undefined} [options]
 */
export async function runDraftAndJudge(supabase, config, options = {}) {
  const runKind = options.runKind ?? (options.topicId ? 'on_demand' : 'scheduled');
  start('runDraftAndJudge', { runKind });

  try {
    const forceTopic = String(options.topicId ?? '').trim();
    const maxAutoPassesRaw = Number(options.maxAutoRevisionPasses ?? 3);
    const maxAutoPasses = Number.isFinite(maxAutoPassesRaw)
      ? Math.max(1, Math.min(6, maxAutoPassesRaw))
      : 3;
    const minRel = options.minRelevanceScore;
    const minForDraft =
      forceTopic || minRel == null || !Number.isFinite(minRel) ? undefined : minRel;
    /** @type {Array<Record<string, any>>} */
    const attempts = [];

    for (let pass = 1; pass <= maxAutoPasses; pass += 1) {
      const draftResult = await runDrafting(supabase, config, {
        topicId: forceTopic || undefined,
        minRelevanceScore: minForDraft,
      });

      let draftId = draftResult.draftId || null;
      if (!draftResult.drafted) {
        // If an unjudged draft already exists, continue pipeline on that draft id.
        if (draftResult.reason === 'unjudged_draft_exists' && draftId) {
          const precheck = await runPreJudgeQualityChecks(supabase, config, draftId);
          if (precheck.blocked) {
            attempts.push({ pass, draftId, draft: draftResult, precheck, judge: null });
            continue;
          }
          const judgeResult = await runJudging(supabase, config, { draftId });
          attempts.push({ pass, draftId, draft: draftResult, precheck, judge: judgeResult });
          if (judgeResult.judged) {
            success('runDraftAndJudge', { runKind, draftId, judged: true, pass });
            return { runKind, draft: draftResult, judge: judgeResult, attempts };
          }
          continue;
        }

        success('runDraftAndJudge', { runKind, reason: draftResult.reason, pass });
        return { runKind, draft: draftResult, judge: null, attempts };
      }

      if (!draftId) {
        const err = new Error('runDrafting returned drafted without draftId');
        fail('runDraftAndJudge', err, { runKind });
        throw err;
      }

      const precheck = await runPreJudgeQualityChecks(supabase, config, draftId);
      if (precheck.blocked) {
        attempts.push({ pass, draftId, draft: draftResult, precheck, judge: null });
        continue;
      }

      const judgeResult = await runJudging(supabase, config, { draftId });
      attempts.push({ pass, draftId, draft: draftResult, precheck, judge: judgeResult });
      if (judgeResult.judged) {
        success('runDraftAndJudge', { runKind, draftId, judged: true, pass });
        return { runKind, draft: draftResult, judge: judgeResult, attempts };
      }
    }

    const last = attempts[attempts.length - 1] || null;
    if (last?.judge?.revised && Number(last?.judge?.composite ?? 0) >= 8.0) {
      try {
        await sendRevisedDraftToSlackReview(supabase, config, last.draftId);
        success('runDraftAndJudge:autoSlackFallback', {
          runKind,
          draftId: last.draftId,
          composite: last.judge.composite,
        });
      } catch (slackErr) {
        fail('runDraftAndJudge:autoSlackFallback', slackErr, {
          draftId: last?.draftId,
        });
      }
    }
    success('runDraftAndJudge', {
      runKind,
      judged: false,
      attempts: attempts.length,
      lastDraftId: last?.draftId ?? null,
    });
    return {
      runKind,
      draft: last?.draft ?? { drafted: false, reason: 'max_auto_passes_reached' },
      judge: last?.judge ?? null,
      precheck: last?.precheck ?? null,
      attempts,
    };
  } catch (error) {
    fail('runDraftAndJudge', error, { runKind });
    throw error;
  }
}

async function sendRevisedDraftToSlackReview(supabase, config, draftId) {
  const { data: draft, error: dErr } = await supabase
    .from('content_drafts')
    .select('id,topic_id,blog_title,blog_body,judge_scores,judge_flags')
    .eq('id', draftId)
    .single();
  if (dErr) throw new Error(dErr.message);

  await supabase
    .from('content_topics')
    .update({ status: 'review', updated_at: new Date().toISOString() })
    .eq('id', draft.topic_id);

  const score = normalizeJudgeScoresFromVerdict(draft.judge_scores);
  const composite = computeJudgeComposite(score);
  const baseUrl = String(config.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const reviewUrl = baseUrl ? `${baseUrl}/api/drafts/${draft.id}/preview` : '';
  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
  await sendReviewMessage(slack, config.SLACK_CHANNEL_ID, {
    draftId: draft.id,
    blog_title: draft.blog_title,
    scores: score,
    composite,
    verdict: 'REVISE',
    blogBody: draft.blog_body,
    revisionNotes: Array.isArray(draft.judge_flags) ? draft.judge_flags.slice(0, 6) : null,
    reviewUrl,
  });
}

async function runPreJudgeQualityChecks(supabase, config, draftId) {
  start('runPreJudgeQualityChecks', { draftId });
  let hasImageAssetRefColumn = true;
  let { data: draft, error } = await supabase
    .from('content_drafts')
    .select(
      'id,topic_id,blog_title,blog_slug,blog_body,linkedin_post,image_prompt,judge_flags,image_asset_ref,content_topics!inner(id,title,source_url)'
    )
    .eq('id', draftId)
    .maybeSingle();
  if (error && String(error.message || '').includes('image_asset_ref')) {
    hasImageAssetRefColumn = false;
    ({ data: draft, error } = await supabase
      .from('content_drafts')
      .select(
        'id,topic_id,blog_title,blog_slug,blog_body,linkedin_post,image_prompt,judge_flags,content_topics!inner(id,title,source_url)'
      )
      .eq('id', draftId)
      .maybeSingle());
  }
  if (error) throw new Error(error.message);
  if (!draft) return { blocked: true, reason: 'draft_not_found' };

  start('runPreJudgeQualityChecks:format');
  const updates = {};
  const normalizedSections = normalizeBlogBody(draft.blog_body);
  const withCta = ensureCtaInClosing(normalizedSections);
  updates.blog_body = withCta;
  updates.linkedin_post = ensureLinkedInCta(draft.linkedin_post);
  success('runPreJudgeQualityChecks:format', { draftId });

  start('runPreJudgeQualityChecks:research');
  const citationGate = await enforceCitationRequirements({
    draft: { ...draft, blog_body: withCta },
    topicSourceUrl: draft.content_topics?.source_url,
    anthropicApiKey: config.ANTHROPIC_API_KEY,
    model: config.ANTHROPIC_MODEL,
    enforce: config.PREJUDGE_ENFORCE_VERIFIED_CITATIONS !== false,
  });
  success('runPreJudgeQualityChecks:research', {
    draftId,
    blocked: citationGate.blocked,
    flags: citationGate.flags,
    warnings: citationGate.warnings,
  });
  updates.blog_body = citationGate.blogBody;
  // Persist soft warnings (paywalled sources) on judge_flags so they survive
  // the judge's flag overwrite and surface in the Slack review message.
  if (Array.isArray(citationGate.warnings) && citationGate.warnings.length) {
    const existingFlags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];
    updates.judge_flags = [...existingFlags, ...citationGate.warnings];
  }

  start('runPreJudgeQualityChecks:compile');
  const imageRef = await ensureDraftImageAsset({
    config,
    draft: { ...draft, blog_body: updates.blog_body },
  });
  if (imageRef && hasImageAssetRefColumn) {
    updates.image_asset_ref = imageRef;
    updates.image_generated = true;
  }

  const { error: updateErr } = await supabase
    .from('content_drafts')
    .update(updates)
    .eq('id', draftId);
  if (updateErr) throw new Error(updateErr.message);

  if (citationGate.blocked) {
    const nextFlags = [
      ...(Array.isArray(draft.judge_flags) ? draft.judge_flags : []),
      ...citationGate.flags,
      ...(citationGate.warnings ?? []),
    ];
    await supabase
      .from('content_drafts')
      .update({ judge_pass: false, judge_flags: nextFlags })
      .eq('id', draftId);
    await supabase
      .from('content_topics')
      .update({ status: 'revision', updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);
    // Notify Slack so prejudge failures are not silent. Best-effort — do not
    // throw if Slack itself errors.
    try {
      await sendPrejudgeBlockedNotification({
        config,
        draftId,
        topicId: draft.topic_id,
        topicTitle: draft.content_topics?.title ?? draft.blog_title ?? '(untitled)',
        topicSourceUrl: draft.content_topics?.source_url ?? '',
        flags: citationGate.flags,
      });
    } catch (slackErr) {
      fail('runPreJudgeQualityChecks:slack', slackErr, { draftId });
    }
    return {
      blocked: true,
      reason: 'missing_verified_citations',
      flags: citationGate.flags,
    };
  }

  success('runPreJudgeQualityChecks:compile', { draftId });
  success('runPreJudgeQualityChecks', { draftId, blocked: false });
  return { blocked: false };
}

function normalizeBlogBody(blogBody) {
  const sections = Array.isArray(blogBody) ? blogBody : [];
  return sections.map((section) => {
    let body = String(section?.body ?? '')
      .replaceAll('\r\n', '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/^\s*•\s+/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Convert bare URLs in prose into Markdown links. Crucially, only match
    // URLs preceded by whitespace or start-of-string — NOT by `(`. URLs that
    // sit inside Markdown link syntax `[text](url)` are preceded by `(`, and
    // matching them here corrupts the link into `[text]([source](url))`.
    body = body.replace(
      /(^|\s)(https?:\/\/[^\s)]+)/g,
      (_m, prefix, url) => `${prefix}[source](${url})`
    );
    return {
      ...section,
      title: String(section?.title ?? '').trim(),
      body,
    };
  });
}

function ensureCtaInClosing(blogBody) {
  if (!Array.isArray(blogBody) || !blogBody.length) return blogBody;
  const out = [...blogBody];
  const lastIdx = out.length - 1;
  const closing = String(out[lastIdx]?.body ?? '');
  const hasSite = closing.includes('https://fintechlaw.ai');
  const hasContact = closing.includes('https://fintechlaw.ai/contact');
  if (hasSite && hasContact) return out;
  const addition =
    '\n\nIf your team is building in fintech, FinTech Law can help you design practical compliance programs and launch safely. Learn more at [FinTech Law](https://fintechlaw.ai) and [contact us](https://fintechlaw.ai/contact).';
  out[lastIdx] = { ...out[lastIdx], body: `${closing}${addition}`.trim() };
  return out;
}

function ensureLinkedInCta(linkedinPost) {
  const text = String(linkedinPost ?? '').trim();
  if (!text) return text;
  if (text.includes('https://fintechlaw.ai/contact')) return text;
  return `${text}\n\nGet practical guidance at https://fintechlaw.ai/contact`;
}

async function enforceCitationRequirements({
  draft,
  topicSourceUrl,
  anthropicApiKey,
  model,
  enforce,
}) {
  const primary = String(topicSourceUrl ?? '').trim();
  const extracted = extractHttpUrlsFromDraft(draft);
  const candidates = [...new Set([primary, ...extracted].filter(Boolean))].slice(0, 12);
  const fetches = await fetchAllCitationPreviews(candidates);
  let subagent = null;
  if (anthropicApiKey) {
    try {
      const client = createAnthropicClient(anthropicApiKey);
      subagent = await runCitationVerificationSubagent(
        client,
        { ANTHROPIC_MODEL: model },
        { draft, fetches }
      );
    } catch {
      subagent = null;
    }
  }
  // Paywall / bot-blocking statuses. The source genuinely exists; our fetcher
  // just cannot read it. Treat as "verified existence, manual review needed"
  // rather than "missing", so Cloudflare-protected sites (theblock.co, etc.)
  // do not silently fail the whole pipeline.
  const PAYWALL_STATUSES = new Set([401, 403, 410, 451]);
  const verified = fetches.filter((f) => f.ok);
  const paywalled = fetches.filter((f) => PAYWALL_STATUSES.has(Number(f.status)));

  const primaryVerified = primary
    ? fetches.some((v) => v.ok && samePrimarySource(v.url, primary, v.finalUrl))
    : false;
  const primaryPaywalled = primary && !primaryVerified
    ? paywalled.some((v) => samePrimarySource(v.url, primary, v.finalUrl))
    : false;

  const secondaryVerified = verified.find(
    (v) => !samePrimarySource(v.url, primary, v.finalUrl)
  );
  const secondaryPaywalled = !secondaryVerified
    ? paywalled.find((v) => !samePrimarySource(v.url, primary, v.finalUrl))
    : null;
  // For citation block + URL surfacing, prefer verified, fall back to paywalled.
  const secondary = secondaryVerified || secondaryPaywalled;

  let blogBody = Array.isArray(draft.blog_body) ? [...draft.blog_body] : [];
  // Primary-source backstop intentionally NOT injected into the opening section.
  // The drafter already cites it inline in natural prose, and the "Verified Sources"
  // block below restates it at the end. Reviewer feedback (2026-05-02) called the
  // duplicated explicit "Primary source: Original Report" line in the intro
  // out-of-place; the judge had separately flagged it as editorial_artifact.
  const primaryUsable = primaryVerified || primaryPaywalled;
  const citationLines = [];
  if (primaryUsable && primary) {
    const tag = primaryPaywalled && !primaryVerified ? ' (paywalled — verify manually)' : '';
    citationLines.push(`- **Primary source:** [Original report](${primary})${tag}`);
  }
  if (secondary?.finalUrl || secondary?.url) {
    const secondaryUrl = secondary.finalUrl || secondary.url;
    const tag = !secondaryVerified && secondaryPaywalled ? ' (paywalled — verify manually)' : '';
    citationLines.push(`- **Secondary source:** [Independent verification](${secondaryUrl})${tag}`);
  }
  if (citationLines.length) {
    blogBody.push({
      title: 'Verified Sources',
      body: `## Verified citations\n\n${citationLines.join('\n')}`,
      has_background: false,
    });
  }

  if (!enforce) {
    return { blocked: false, blogBody, flags: [], warnings: [] };
  }
  // Hard blocks: source truly missing / unreachable / misrepresented
  const missing = [];
  // Soft warnings: source exists but cannot be auto-verified (paywall / bot block).
  // Manual review needed but pipeline continues.
  const warnings = [];

  if (!primary) {
    missing.push('missing_primary_source_url');
  } else if (!primaryVerified && !primaryPaywalled) {
    missing.push('missing_verified_primary_citation');
  } else if (primaryPaywalled && !primaryVerified) {
    warnings.push(`primary_source_paywalled: ${primary}`);
  }

  if (!secondary) {
    missing.push('missing_verified_secondary_citation');
  } else if (!secondaryVerified && secondaryPaywalled) {
    const url = secondaryPaywalled.finalUrl || secondaryPaywalled.url;
    warnings.push(`secondary_source_paywalled: ${url}`);
  }

  if (Array.isArray(subagent?.assessments)) {
    const hasBroken = subagent.assessments.some(
      (a) => a?.verdict === 'broken_or_unreachable' || a?.verdict === 'misaligned'
    );
    if (hasBroken) missing.push('citation_subagent_flagged_misalignment');
  }
  return {
    blocked: missing.length > 0,
    blogBody,
    flags: missing.map((m) => `prejudge:${m}`),
    warnings: warnings.map((w) => `prejudge_warning:${w}`),
  };
}

function sameUrlTarget(a, b) {
  try {
    const ua = new URL(String(a ?? ''));
    const ub = new URL(String(b ?? ''));
    return ua.hostname === ub.hostname && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

function samePrimarySource(url, primary, finalUrl = '') {
  if (!primary) return false;
  const candidates = [url, finalUrl].filter(Boolean);
  return candidates.some((c) => sameUrlTarget(c, primary) || sameUrlHost(c, primary));
}

function sameUrlHost(a, b) {
  try {
    const ua = new URL(String(a ?? ''));
    const ub = new URL(String(b ?? ''));
    return ua.hostname === ub.hostname;
  } catch {
    return false;
  }
}

async function sendPrejudgeBlockedNotification({
  config,
  draftId,
  topicId,
  topicTitle,
  topicSourceUrl,
  flags,
}) {
  const token = config.SLACK_BOT_TOKEN;
  const channel = config.SLACK_CHANNEL_ID;
  if (!token || !channel) return;
  const slack = createSlackClient(token);
  const flagList = (flags ?? []).map((f) => `• ${f}`).join('\n');
  const text =
    `⚠️ *Prejudge gate blocked a draft — manual action needed*\n\n` +
    `*Topic:* ${topicTitle}\n` +
    `*Source:* ${topicSourceUrl || '(none)'}\n` +
    `*Topic ID:* \`${topicId}\`\n` +
    `*Draft ID:* \`${draftId}\`\n\n` +
    `*Reasons:*\n${flagList}\n\n` +
    `The draft was created but cannot reach the judge. Either fix the source URL, ` +
    `archive the topic, or run \`/api/start-production?topicId=${topicId}\` after fixing.`;
  await slack.chat.postMessage({ channel, text });
}

async function ensureDraftImageAsset({ config, draft }) {
  const existing = String(draft.image_asset_ref ?? '').trim();
  if (existing) return existing;
  if (!config.XAI_API_KEY || !draft.image_prompt) return '';
  try {
    const sanityClient = createSanityClient(config);
    const slugPart = String(draft.blog_slug || 'blog').slice(0, 40);
    const ref = await generateAndUploadImage({
      prompt: draft.image_prompt,
      sanityClient,
      xaiApiKey: config.XAI_API_KEY,
      filename: `${slugPart}.png`,
    });
    return ref?._ref ?? '';
  } catch (error) {
    fail('ensureDraftImageAsset', error, { draftId: draft.id });
    return '';
  }
}
