import { createSlackClient } from '../integrations/slack.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('slack-weekly-report');

/**
 * Weekly content report — sends a Slack summary every Monday morning.
 * Covers the past 7 days: posts published, social media stats, pipeline activity.
 */
export async function runWeeklyReport(supabase, config) {
  start('runWeeklyReport');

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Published topics this week
  const { data: published, error: pubErr } = await supabase
    .from('content_topics')
    .select('id, title, updated_at')
    .eq('status', 'published')
    .gte('updated_at', sevenDaysAgo)
    .order('updated_at', { ascending: false });
  if (pubErr) throw new Error(pubErr.message);

  // Pipeline activity: topics scanned, ranked, rejected this week
  const { data: allTopics, error: allErr } = await supabase
    .from('content_topics')
    .select('id, status')
    .gte('created_at', sevenDaysAgo);
  if (allErr) throw new Error(allErr.message);

  const scanned = (allTopics ?? []).length;
  const ranked = (allTopics ?? []).filter((t) => t.status !== 'pending' && t.status !== 'archived').length;

  // Drafts with social post IDs this week
  const publishedIds = (published ?? []).map((t) => t.id);
  let analytics = [];
  if (publishedIds.length) {
    const { data: drafts, error: draftErr } = await supabase
      .from('content_drafts')
      .select('id, topic_id, blog_title, blog_slug, linkedin_post_id, x_post_id')
      .in('topic_id', publishedIds);
    if (draftErr) throw new Error(draftErr.message);

    // Get analytics rows for these drafts
    const draftIds = (drafts ?? []).map((d) => d.id);
    if (draftIds.length) {
      const { data: rows } = await supabase
        .from('content_analytics')
        .select('draft_id, platform, impressions, engagements')
        .in('draft_id', draftIds);
      analytics = rows ?? [];
    }
  }

  const totalImpressions = analytics.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
  const totalEngagements = analytics.reduce((sum, r) => sum + (r.engagements ?? 0), 0);
  const linkedInPosts = analytics.filter((r) => r.platform === 'linkedin').length;
  const xPosts = analytics.filter((r) => r.platform === 'x').length;

  // Build Slack message
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Weekly Content Report', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}*\n\n` +
          `*Pipeline Activity*\n` +
          `- Topics scanned: ${scanned}\n` +
          `- Topics advanced past ranking: ${ranked}\n` +
          `- Blog posts published: ${(published ?? []).length}`,
      },
    },
  ];

  // List published posts
  if (published?.length) {
    const postList = published
      .map((t) => `- ${t.title}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Published This Week*\n${postList}` },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No blog posts published this week._' },
    });
  }

  // Social media summary
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*Social Media*\n` +
        `- LinkedIn posts: ${linkedInPosts}\n` +
        `- X posts: ${xPosts}\n` +
        `- Total impressions: ${totalImpressions.toLocaleString()}\n` +
        `- Total engagements: ${totalEngagements.toLocaleString()}`,
    },
  });

  // Pending work
  const { data: pending } = await supabase
    .from('content_topics')
    .select('id')
    .in('status', ['pending', 'ranked', 'drafting', 'judging', 'review', 'revision', 'approved']);
  const inPipeline = (pending ?? []).length;

  if (inPipeline > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*In Pipeline:* ${inPipeline} topic(s) currently being processed` },
    });
  }

  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
  const channelId = normalizeChannelId(config.SLACK_CHANNEL_ID);

  const result = await breaker.execute(
    () =>
      slack.chat.postMessage({
        channel: channelId,
        text: `Weekly Content Report — ${(published ?? []).length} posts published`,
        blocks,
      }),
    { ok: false, error: 'slack_unavailable' }
  );

  if (!result.ok) {
    const err = new Error(String(result.error ?? 'weekly_report_failed'));
    fail('runWeeklyReport', err);
  } else {
    success('runWeeklyReport', {
      published: (published ?? []).length,
      linkedInPosts,
      xPosts,
    });
  }

  return {
    published: (published ?? []).length,
    scanned,
    linkedInPosts,
    xPosts,
    totalImpressions,
    totalEngagements,
  };
}

function normalizeChannelId(channel) {
  const raw = String(channel ?? '').trim();
  if (/^[CG][A-Z0-9]{8,}$/i.test(raw)) return raw;
  const match = raw.match(/([CG][A-Z0-9]{8,})/i);
  if (match?.[1]) return match[1];
  return raw;
}
