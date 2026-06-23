import { createAnthropicClient, promptJson } from '../integrations/anthropic.js';
import { createSlackClient, sendReviewMessage } from '../integrations/slack.js';
import { getBrand } from '../config/brands/index.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from '../prompts/judge-system.js';
import { reviseBlogContent } from './blog-reviser.js';
import { reviseSocialContent } from './social-reviser.js';
import { extractHttpUrlsFromDraft, fetchAllCitationPreviews } from './citation-harvest.js';
import { runCitationVerificationSubagent } from './citation-subagent.js';
import { runClaimVerificationSubagent } from './claim-verification-subagent.js';
import {
  computeJudgeComposite,
  deriveJudgeVerdict,
  normalizeJudgeScores,
} from './verdict.js';
import {
  buildBracketLeakRevisionInstruction,
  findBracketLeaksInDraft,
} from '../utils/bracket-leak.js';
import { fail, start, success } from '../utils/logger.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, any>} config
 * @param {{ draftId?: string, preverifiedLinkContext?: { fetches: any[], subagent: any } | null } | undefined} [options]
 * @description When `options.draftId` is set, judges only that row if it is not yet judged.
 * Otherwise picks the oldest unjudged draft.
 *
 * If `options.preverifiedLinkContext` is provided (from prejudge), the judge skips
 * its own citation fetch + subagent pass and reuses the prejudge result. This is
 * the path the production cron uses to stay under the Anthropic input-token budget.
 */
export async function runJudging(supabase, config, options = {}) {
  start('runJudging');
  try {
    const forceDraftId = String(options.draftId ?? '').trim();
    let draft;
    if (forceDraftId) {
      const { data: d, error: dErr } = await supabase
        .from('content_drafts')
        .select('*')
        .eq('id', forceDraftId)
        .maybeSingle();
      if (dErr) throw new Error(dErr.message);
      if (!d) return { judged: false, reason: 'draft_not_found' };
      if (d.judge_pass != null) {
        return { judged: false, reason: 'already_judged', pass: d.judge_pass, draftId: d.id };
      }
      draft = d;
    } else {
      // Pull a small candidate set so we can skip drafts that have already
      // hit the defer cap in JS. Postgres can't easily count prefixed
      // entries inside a JSONB array, and a max-deferred draft would
      // otherwise loop forever as the oldest unjudged row.
      const MAX_DEFERS = 4;
      const { data, error } = await supabase
        .from('content_drafts')
        .select('*')
        .is('judge_pass', null)
        .order('created_at', { ascending: true })
        .limit(10);
      if (error) throw new Error(error.message);
      const candidate = (data ?? []).find((d) => {
        const flags = Array.isArray(d.judge_flags) ? d.judge_flags : [];
        const defers = flags.filter((f) => typeof f === 'string' && f.startsWith('defer:'));
        return defers.length < MAX_DEFERS;
      });
      if (!candidate) return { judged: false, reason: 'no_unjudged_drafts' };
      draft = candidate;
    }

    const client = createAnthropicClient(config.ANTHROPIC_API_KEY);

    const preverified = options.preverifiedLinkContext ?? null;
    const reuseCitation = !!(preverified?.subagent && Array.isArray(preverified?.fetches));

    let linkFetches;
    let subagent;
    if (reuseCitation) {
      linkFetches = preverified.fetches;
      subagent = preverified.subagent;
    } else {
      const citedUrls = extractHttpUrlsFromDraft(draft);
      linkFetches = await fetchAllCitationPreviews(citedUrls);
    }

    // Always run claim verification — it does web search, not URL-fetch, so the
    // prejudge stage hasn't done it. Run citation subagent only if we don't have
    // a prejudge result to reuse.
    //
    // Run sequentially — both subagents share the same per-model TPM bucket
    // (default Haiku), and back-to-back parallel calls were the original
    // 11:01 cascade that caused 30k Sonnet TPM to crater. Sequential adds
    // ~10s latency on average and removes a whole class of rate-limit failures.
    const subagentResult = reuseCitation
      ? subagent
      : await runCitationVerificationSubagent(client, config, { draft, fetches: linkFetches });
    const claimVerification = await runClaimVerificationSubagent(client, config, { draft });
    subagent = subagentResult;

    const contradictedClaims = (claimVerification?.assessments ?? []).filter(
      (a) => a.verdict === 'contradicted'
    );

    // The main judge prompt only needs claims that *failed* — supported
    // claims are noise that inflates Sonnet input tokens by 30%+ on long
    // drafts. Drop the supported/unverifiable assessments; keep summary +
    // flags for context. Contradicted claims drive both the verdict
    // override and the revision instructions, so we surface only those.
    const judgeClaimContext = claimVerification
      ? {
          assessments: contradictedClaims,
          contradicted_count: contradictedClaims.length,
          subagent_flags: claimVerification.subagent_flags ?? [],
          subagent_summary: claimVerification.subagent_summary ?? '',
        }
      : null;
    const linkContext = { fetches: linkFetches, subagent, claimVerification: judgeClaimContext };

    const editorialMeta = draft.editorial_meta ?? null;

    const brandId = draft.brand_id ?? 'fintechlaw';
    const brand = getBrand(brandId);

    let result;
    try {
      result = await promptJson(client, {
        model: config.ANTHROPIC_MODEL,
        system: brand.prompts.judgeSystem ?? JUDGE_SYSTEM_PROMPT,
        user: (brand.prompts.buildJudgeUser ?? buildJudgeUserPrompt)({ draft, linkContext, editorialMeta }),
        maxTokens: 3_200,
        temperature: 0.1,
      });
    } catch (anthropicErr) {
      // Anthropic unavailable (rate limit, network, breaker open). Do NOT fabricate
      // a 0-score REJECT — that silently kills good drafts. Leave the draft in a
      // re-judgeable state (judge_pass null), keep topic status unchanged, and
      // notify Slack so a human knows. Next judge tick will retry.
      const previousFlags = Array.isArray(draft.judge_flags) ? draft.judge_flags : [];
      const previousDefers = previousFlags.filter((f) =>
        typeof f === 'string' && f.startsWith('defer:')
      ).length;
      const deferAttempt = previousDefers + 1;
      const MAX_DEFERS = 4;
      const exhausted = deferAttempt >= MAX_DEFERS;
      const reasonText = anthropicErr?.message || anthropicErr?.tag || 'anthropic_unavailable';

      try {
        await supabase
          .from('content_drafts')
          .update({
            judge_flags: [
              ...previousFlags,
              `defer:${new Date().toISOString()}:${(reasonText || '').slice(0, 200)}`,
            ],
          })
          .eq('id', draft.id);
      } catch (dbErr) {
        fail('runJudging:deferTrack', dbErr, { draftId: draft.id });
      }

      // Slack notification cadence: alert on attempt #1 (something is wrong)
      // and on the final attempt (gave up). Suppress middle retries so the
      // channel doesn't get hammered every 5 min on a multi-hour outage.
      const shouldNotify = deferAttempt === 1 || exhausted;
      if (shouldNotify) {
        try {
          const slack = createSlackClient(config.SLACK_BOT_TOKEN);
          const header = exhausted
            ? `🚨 *Judge gave up after ${MAX_DEFERS} attempts — manual action needed*`
            : `⚠️ *Judge deferred draft (attempt ${deferAttempt}/${MAX_DEFERS}) — will auto-retry*`;
          await slack.chat.postMessage({
            channel: config.SLACK_CHANNEL_ID,
            text:
              `${header}\n` +
              `*Draft:* \`${draft.id}\` (${draft.blog_title || 'untitled'})\n` +
              `*Reason:* ${reasonText}\n` +
              (exhausted
                ? `Run \`/api/judge-now\` after fixing, or archive the topic.`
                : `Next retry on the \`*/5 min\` judge cron.`),
          });
        } catch (slackErr) {
          fail('runJudging:fallbackSlack', slackErr, { draftId: draft.id });
        }
      }

      success('runJudging', {
        draftId: draft.id,
        deferred: true,
        attempt: deferAttempt,
        exhausted,
        reason: reasonText.slice(0, 200),
      });
      return {
        judged: false,
        deferred: true,
        exhausted,
        attempt: deferAttempt,
        draftId: draft.id,
        reason: reasonText,
      };
    }

    // Composite + verdict are computed in code (single source of truth in verdict.js).
    // Any composite/verdict the LLM happens to return is ignored.
    const normalizedScores = normalizeJudgeScores(result.scores);
    const composite = computeJudgeComposite(normalizedScores);
    let verdict = deriveJudgeVerdict({ composite, scores: normalizedScores });

    // Revision budget. Contradiction-driven REVISEs get 2 passes — the first
    // rewrite often surfaces new issues that a second pass closes. Other
    // REVISEs get 1.
    const revisionsUsed = draft.revision_count ?? 0;
    const revisionCap = contradictedClaims.length ? 2 : 1;

    // Hard override: any contradicted factual claim forces at least REVISE
    // while revision budget remains, even if the LLM-derived verdict is REJECT.
    // The claim verifier hands the drafter concrete corrections (URL + rationale
    // per claim), so a low-accuracy draft is worth retrying as a rewrite. Once
    // the budget is exhausted, fall through to Slack with contradictions
    // surfaced as advisory notes.
    if (
      contradictedClaims.length &&
      verdict !== 'REVISE' &&
      revisionsUsed < revisionCap
    ) {
      verdict = 'REVISE';
    }

    // Bracket-leak override (item #2): the drafter persisted prejudge_warning:
    // bracket_leak entries when it left placeholder strings like "[insert
    // docket number]" in the output. Detect those AND re-scan the current
    // draft body — the model may have emitted new ones inside a section the
    // drafter guard missed. Both routes force at least REVISE so the reviser
    // can resolve the offending substrings precisely.
    const bracketLeakSubstrings = findBracketLeaksInDraft(draft);
    const bracketLeakInstruction = bracketLeakSubstrings.length
      ? buildBracketLeakRevisionInstruction(bracketLeakSubstrings)
      : '';
    if (
      bracketLeakSubstrings.length &&
      verdict !== 'REVISE' &&
      revisionsUsed < revisionCap
    ) {
      verdict = 'REVISE';
    }

    // Editorial-discipline override: if the judge emitted any topic_drift /
    // angle_drift / lens_drift / missing_facts_in_body flag and revision
    // budget remains, force REVISE. Same pattern as bracket_leak /
    // contradicted_claims above — keep generic compliance padding and
    // declared-angle drift from sneaking past a passing composite score.
    const judgeFlagsLower = (Array.isArray(result?.flags) ? result.flags : [])
      .map((f) => String(f ?? '').toLowerCase());
    const editorialDriftDetected = judgeFlagsLower.some(
      (f) =>
        f.includes('topic_drift') ||
        f.includes('angle_drift') ||
        f.includes('lens_drift') ||
        f.includes('missing_facts_in_body')
    );
    if (
      editorialDriftDetected &&
      verdict !== 'REVISE' &&
      revisionsUsed < revisionCap
    ) {
      verdict = 'REVISE';
    }

    // Also force REVISE if the drafter persisted a prejudge_warning saying
    // the editorial-discipline metadata itself was missing or malformed —
    // we want a clean re-draft with the angle/lens/facts populated before
    // the post can ship.
    const editorialMetaPrejudge = (Array.isArray(draft.judge_flags) ? draft.judge_flags : [])
      .some((f) => typeof f === 'string' && f.startsWith('prejudge_warning: editorial_meta:'));
    if (
      editorialMetaPrejudge &&
      verdict !== 'REVISE' &&
      revisionsUsed < revisionCap
    ) {
      verdict = 'REVISE';
    }

    const isPassing = verdict === 'PASS';
    const isRevise = verdict === 'REVISE';

    // Pull any prejudge warnings (e.g. paywalled sources) that runPreJudgeQualityChecks
    // persisted on judge_flags before this judge call. Preserve them across the
    // upcoming judge_flags overwrite so the Slack review message can surface them.
    const prejudgeWarnings = (Array.isArray(draft.judge_flags) ? draft.judge_flags : [])
      .filter((f) => typeof f === 'string' && f.startsWith('prejudge_warning:'));
    const manualVerificationNotes = prejudgeWarnings.map((w) =>
      w.replace(/^prejudge_warning:\s*/, '').trim()
    );

    // Surface any contradicted factual claims to the human reviewer in Slack,
    // even if the draft is going to PASS or has already exhausted revisions.
    for (const c of contradictedClaims) {
      const note = `Factually contradicted claim: "${c.claim}". ${c.rationale}${
        c.evidence_url ? ` (source: ${c.evidence_url})` : ''
      }`;
      manualVerificationNotes.push(note);
    }

    // Inject contradicted claims as explicit revision instructions when we're sending
    // back to the drafter — the LLM judge should already do this from the prompt, but
    // we belt-and-suspenders it so a contradiction never silently slips through.
    const contradictedRevisionInstructions = contradictedClaims.map(
      (c) =>
        `Correct this factually contradicted claim: "${c.claim}". Per ${
          c.evidence_url || 'authoritative sources'
        }: ${c.rationale}`
    );
    const bracketLeakInstructionList = bracketLeakInstruction
      ? [bracketLeakInstruction]
      : [];
    const allRevisionInstructions = [
      ...bracketLeakInstructionList,
      ...contradictedRevisionInstructions,
      ...(result.revision_instructions ?? []),
    ];

    // Also surface bracket leaks to the human reviewer if we fall through to
    // Slack (revision budget exhausted, or REVISE turned into PASS-at-cap).
    if (bracketLeakSubstrings.length) {
      manualVerificationNotes.push(
        `Editorial placeholder strings remain in the draft: ${bracketLeakSubstrings.join(' | ')}`
      );
    }

    const contradictedFlag = contradictedClaims.length ? ['factually_contradicted'] : [];
    const bracketLeakFlag = bracketLeakSubstrings.length ? ['bracket_leak'] : [];

    // If the surgical reviser fails inside the REVISE branch below, we capture
    // the failure note here and fall through to the Slack review block with a
    // terminal label. Hoisted so the post-block judge_flags merge can pick it
    // up without re-reading state.
    let surgicalRevisionFailedNote = null;

    // REVISE with budget remaining: surgically revise the existing draft in
    // place using reviseBlogContent (and reviseSocialContent when feedback
    // touches social). The reviser preserves unchanged sections byte-for-byte
    // and resets judge_pass to null so the next judge tick re-judges. This
    // replaces the old "flip topic to revision and wait for the next dailyDrafter
    // cron" path — that flow stalled mid-day when the daily drafter wouldn't
    // run again until 7 AM ET the following day.
    if (isRevise && revisionsUsed < revisionCap) {
      const revisionFeedback = allRevisionInstructions
        .map((i) => String(i).trim())
        .filter(Boolean)
        .join('\n\n---\n\n');

      let surgicalSucceeded = false;
      let surgicalError = null;
      try {
        await reviseBlogContent(supabase, config, draft.id, revisionFeedback);
        surgicalSucceeded = true;
      } catch (reviseErr) {
        surgicalError = reviseErr;
        fail('runJudging:reviseBlogContent', reviseErr, { draftId: draft.id });
      }

      // If feedback names a social surface, run the surgical social reviser too.
      // Best-effort — a failure here doesn't stop the blog re-judge.
      const socialMatcher = /\b(linkedin|x[\s_-]?(post|tweet|thread)|tweet|hashtag)\b/i;
      const touchesSocial =
        surgicalSucceeded &&
        allRevisionInstructions.some((i) => socialMatcher.test(String(i)));
      if (touchesSocial) {
        try {
          await reviseSocialContent(supabase, config, draft.id, revisionFeedback);
        } catch (reviseSocErr) {
          fail('runJudging:reviseSocialContent', reviseSocErr, { draftId: draft.id });
        }
      }

      // Citation review pass on the revised draft (item 2c). Validates URLs
      // and surfaces any new broken/contradicted citations as prejudge_warning
      // flags so the next judge tick can use them as preverified context and
      // the human reviewer sees them in Slack.
      if (surgicalSucceeded) {
        try {
          const { data: revisedDraft, error: revErr } = await supabase
            .from('content_drafts')
            .select('*')
            .eq('id', draft.id)
            .single();
          if (revErr || !revisedDraft) {
            throw new Error(revErr?.message || 'revised_draft_not_found');
          }
          const citedUrls = extractHttpUrlsFromDraft(revisedDraft);
          const revisedFetches = await fetchAllCitationPreviews(citedUrls);
          const citationReview = await runCitationVerificationSubagent(client, config, {
            draft: revisedDraft,
            fetches: revisedFetches,
          });
          const subagentFlagWarnings = (citationReview?.subagent_flags ?? []).map(
            (f) => `prejudge_warning: post-revision citation: ${String(f).slice(0, 200)}`
          );
          const failedAssessments = (citationReview?.assessments ?? [])
            .filter((a) => a && a.verdict && a.verdict !== 'verified')
            .map(
              (a) =>
                `prejudge_warning: post-revision citation: ${a.url ?? '(no url)'} — ${
                  a.verdict
                }${a.rationale ? `: ${String(a.rationale).slice(0, 200)}` : ''}`
            );
          const newWarnings = [...subagentFlagWarnings, ...failedAssessments];
          if (newWarnings.length) {
            // reviseBlogContent cleared judge_flags; merge our warnings into
            // the now-empty array so the next judge tick can read them.
            const existing = Array.isArray(revisedDraft.judge_flags)
              ? revisedDraft.judge_flags
              : [];
            await supabase
              .from('content_drafts')
              .update({ judge_flags: [...existing, ...newWarnings] })
              .eq('id', draft.id);
          }
          success('runJudging:postReviseCitation', {
            draftId: draft.id,
            warnings: newWarnings.length,
          });
        } catch (citationErr) {
          fail('runJudging:postReviseCitation', citationErr, { draftId: draft.id });
        }
      }

      if (surgicalSucceeded) {
        // Topic stays in 'judging' — this draft will be re-picked up by the
        // next judge tick because reviseBlogContent reset judge_pass to null.
        await supabase
          .from('content_topics')
          .update({ status: 'judging', updated_at: new Date().toISOString() })
          .eq('id', draft.topic_id);

        success('runJudging', {
          draftId: draft.id,
          verdict,
          composite,
          revised: true,
          surgical: true,
        });
        return {
          judged: false,
          revised: true,
          surgical: true,
          draftId: draft.id,
          verdict,
          composite,
        };
      }

      // Surgical revision failed — fall through to the standard Slack review
      // path with terminal framing. Record the failure note so the
      // post-block judge_flags update preserves it.
      surgicalRevisionFailedNote = `surgical_revision_failed: ${String(
        surgicalError?.message ?? 'unknown'
      ).slice(0, 200)}`;
      // Bump revision_count so a second round at this stage doesn't keep
      // looping the same failed reviser call.
      await supabase
        .from('content_drafts')
        .update({ revision_count: revisionsUsed + 1 })
        .eq('id', draft.id);
    }

    // PASS / REVISE-at-cap / REJECT all surface to Slack the same way: a
    // reviewable message with verdict, scores, flags, revision notes, and
    // Approve/Request Changes/Reject buttons. REJECT is no longer an
    // auto-reject — the human (or eventually the autonomous override layer)
    // decides whether to publish, request changes, or reject. judge_pass
    // stays the autopublish gate (true on PASS only); the Approve button
    // can flip it manually for an override.
    const judgePass = isPassing;

    await supabase
      .from('content_drafts')
      .update({
        judge_scores: result.scores,
        judge_pass: judgePass,
        judge_flags: [
          ...prejudgeWarnings,
          ...(result.flags ?? []),
          ...contradictedFlag,
          ...bracketLeakFlag,
          ...(surgicalRevisionFailedNote ? [surgicalRevisionFailedNote] : []),
        ],
      })
      .eq('id', draft.id);

    await supabase
      .from('content_topics')
      .update({ status: 'review', updated_at: new Date().toISOString() })
      .eq('id', draft.topic_id);

    const baseUrl = String(config.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
    const reviewUrl = baseUrl ? `${baseUrl}/api/drafts/${draft.id}/preview` : '';

    const slack = createSlackClient(config.SLACK_BOT_TOKEN);
    await sendReviewMessage(slack, config.SLACK_CHANNEL_ID, {
      draftId: draft.id,
      blog_title: draft.blog_title,
      brandLabel: brand.slackLabel,
      scores: normalizedScores,
      composite,
      verdict,
      blogBody: draft.blog_body,
      linkedinPost: draft.linkedin_post,
      xPost: draft.x_post,
      revisionNotes: isPassing ? null : allRevisionInstructions,
      manualVerificationNotes,
      reviewUrl,
    });

    const isFallback = !!result?.flags?.includes('anthropic_unavailable_fallback');
    success('runJudging', { draftId: draft.id, verdict, composite, pass: judgePass, fallback: isFallback });
    return { judged: true, draftId: draft.id, verdict, composite, pass: judgePass, fallback: isFallback };
  } catch (error) {
    fail('runJudging', error);
    throw error;
  }
}
