import { createSlackClient } from '../integrations/slack.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { getEnabledBrands } from '../config/brands/index.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('slack-weekly-report');

/**
 * Weekly content report — per-brand queue depth, publish count, category yield.
 */
export async function runWeeklyReport(supabase, config) {
  start('runWeeklyReport');

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const brands = getEnabledBrands(config);

  const brandSections = [];
  let totalPublished = 0;
  let totalScanned = 0;

  for (const brand of brands) {
    const { data: published } = await supabase
      .from('content_topics')
      .select('id, title, category, updated_at')
      .eq('status', 'published')
      .eq('brand_id', brand.id)
      .gte('updated_at', sevenDaysAgo)
      .order('updated_at', { ascending: false });

    const { data: scannedTopics } = await supabase
      .from('content_topics')
      .select('id, status, category')
      .eq('brand_id', brand.id)
      .gte('created_at', sevenDaysAgo);

    const { count: rankedCount } = await supabase
      .from('content_topics')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'ranked');

    const scanned = (scannedTopics ?? []).length;
    totalScanned += scanned;
    const pubCount = (published ?? []).length;
    totalPublished += pubCount;

    const categoryYield = {};
    for (const t of scannedTopics ?? []) {
      const cat = t.category ?? 'unknown';
      categoryYield[cat] = (categoryYield[cat] ?? 0) + 1;
    }
    const yieldLines = Object.entries(categoryYield)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([cat, n]) => `${cat}: ${n}`)
      .join(', ');

    brandSections.push(
      `*${brand.displayName}* (\`${brand.id}\`)\n` +
        `- Published (7d): ${pubCount}\n` +
        `- Scanned (7d): ${scanned}\n` +
        `- Ranked queue now: ${rankedCount ?? 0}\n` +
        (yieldLines ? `- Scan yield by category: ${yieldLines}` : '')
    );
  }

  const { data: pending } = await supabase
    .from('content_topics')
    .select('id')
    .in('status', ['pending', 'ranked', 'drafting', 'judging', 'review', 'revision', 'approved']);
  const inPipeline = (pending ?? []).length;

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
          `*Totals*\n` +
          `- Topics scanned: ${totalScanned}\n` +
          `- Blog posts published: ${totalPublished}\n` +
          `- In pipeline (all brands): ${inPipeline}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: brandSections.join('\n\n') || '_No brand data._' },
    },
  ];

  const slack = createSlackClient(config.SLACK_BOT_TOKEN);
  const channelId = normalizeChannelId(config.SLACK_CHANNEL_ID);

  const result = await breaker.execute(
    () =>
      slack.chat.postMessage({
        channel: channelId,
        text: `Weekly Content Report — ${totalPublished} posts published`,
        blocks,
      }),
    { ok: false, error: 'slack_unavailable' }
  );

  if (!result.ok) {
    fail('runWeeklyReport', new Error(String(result.error ?? 'weekly_report_failed')));
  } else {
    success('runWeeklyReport', { published: totalPublished, scanned: totalScanned });
  }

  return { published: totalPublished, scanned: totalScanned };
}

function normalizeChannelId(channel) {
  const raw = String(channel ?? '').trim();
  if (/^[CG][A-Z0-9]{8,}$/i.test(raw)) return raw;
  const match = raw.match(/([CG][A-Z0-9]{8,})/i);
  if (match?.[1]) return match[1];
  return raw;
}

/** Count ranked topics for a brand — used by mid-week queue alert. */
export async function countRankedTopics(supabase, brandId) {
  const { count, error } = await supabase
    .from('content_topics')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('status', 'ranked');
  if (error) throw new Error(error.message);
  return count ?? 0;
}
