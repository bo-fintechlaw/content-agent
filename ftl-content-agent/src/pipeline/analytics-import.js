import { fail, start, success } from '../utils/logger.js';

/**
 * Minimal RFC-4180 CSV parser. Handles quoted fields, embedded commas,
 * embedded newlines, and "" escapes. Used for GSC + LinkedIn exports which
 * occasionally wrap URLs containing newlines (utm_medium=Zoho \nSocial, etc.).
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function parsePercent(s) {
  const t = String(s ?? '').replace('%', '').trim();
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n / 100 : null;
}

function parseFloatOrNull(s) {
  const n = Number.parseFloat(String(s ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseIntOrZero(s) {
  const n = Number.parseInt(String(s ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Strip query string + hash + trailing slash so URLs match published_posts_index. */
export function canonicalizeUrl(url) {
  const raw = String(url ?? '').replace(/\s+/g, '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return raw;
  }
}

export function parseGscChartCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const clicksIdx = header.indexOf('clicks');
  const imprIdx = header.indexOf('impressions');
  const ctrIdx = header.indexOf('ctr');
  const posIdx = header.indexOf('position');
  if (dateIdx < 0) throw new Error('GSC chart CSV missing Date column');
  return rows.slice(1)
    .map((r) => ({
      date: String(r[dateIdx] ?? '').trim(),
      clicks: parseIntOrZero(r[clicksIdx]),
      impressions: parseIntOrZero(r[imprIdx]),
      ctr: parsePercent(r[ctrIdx]),
      position: parseFloatOrNull(r[posIdx]),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

export function parseGscPagesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const urlIdx = header.findIndex((h) => h.includes('page'));
  const clicksIdx = header.indexOf('clicks');
  const imprIdx = header.indexOf('impressions');
  const ctrIdx = header.indexOf('ctr');
  const posIdx = header.indexOf('position');
  if (urlIdx < 0) throw new Error('GSC pages CSV missing page column');
  return rows.slice(1)
    .map((r) => ({
      url: canonicalizeUrl(r[urlIdx]),
      rawUrl: String(r[urlIdx] ?? '').replace(/\s+/g, ' ').trim(),
      clicks: parseIntOrZero(r[clicksIdx]),
      impressions: parseIntOrZero(r[imprIdx]),
      ctr: parsePercent(r[ctrIdx]),
      position: parseFloatOrNull(r[posIdx]),
    }))
    .filter((r) => r.url);
}

export function parseGscQueriesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const queryIdx = header.findIndex((h) => h.includes('quer'));
  const clicksIdx = header.indexOf('clicks');
  const imprIdx = header.indexOf('impressions');
  const ctrIdx = header.indexOf('ctr');
  const posIdx = header.indexOf('position');
  if (queryIdx < 0) throw new Error('GSC queries CSV missing query column');
  return rows.slice(1)
    .map((r) => ({
      query: String(r[queryIdx] ?? '').trim(),
      clicks: parseIntOrZero(r[clicksIdx]),
      impressions: parseIntOrZero(r[imprIdx]),
      ctr: parsePercent(r[ctrIdx]),
      position: parseFloatOrNull(r[posIdx]),
    }))
    .filter((r) => r.query);
}

/**
 * LinkedIn post-level export. LinkedIn's Posts → Export gives a CSV with
 * varying header names depending on locale. We resolve columns by fuzzy
 * header matching so a slightly-different export still ingests.
 */
export function parseLinkedInPostsCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const findCol = (...needles) => {
    for (const needle of needles) {
      const idx = header.findIndex((h) => h === needle || h.includes(needle));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const urlIdx = findCol('post url', 'post link', 'url');
  const titleIdx = findCol('post title', 'title');
  const dateIdx = findCol('posted date', 'created date', 'post date', 'created');
  const imprIdx = findCol('impressions');
  const reactIdx = findCol('reactions', 'likes');
  const commentsIdx = findCol('comments');
  const sharesIdx = findCol('reposts', 'shares');
  const clicksIdx = findCol('clicks');
  const engRateIdx = findCol('engagement rate');

  return rows.slice(1)
    .map((r) => ({
      url: String(r[urlIdx] ?? '').trim(),
      title: String(r[titleIdx] ?? '').trim(),
      postedDate: String(r[dateIdx] ?? '').trim(),
      impressions: parseIntOrZero(r[imprIdx]),
      reactions: parseIntOrZero(r[reactIdx]),
      comments: parseIntOrZero(r[commentsIdx]),
      shares: parseIntOrZero(r[sharesIdx]),
      clicks: parseIntOrZero(r[clicksIdx]),
      engagementRate: parsePercent(r[engRateIdx]),
    }))
    .filter((r) => r.url || r.title);
}

export function urnFromLinkedInUrl(url) {
  const m = String(url ?? '').match(/(urn:li:(?:share|activity|ugcPost):\d+)/i);
  return m ? m[1] : null;
}

/**
 * Last-write-wins dedupe by idem_key. Postgres rejects ON CONFLICT when the
 * same conflict key appears twice in a single upsert batch, so we collapse
 * dupes in-process. Used for chart_daily and linkedin_post where dupes
 * shouldn't occur but might (re-exports etc.).
 */
function dedupeByIdemKey(rows) {
  const seen = new Map();
  for (const row of rows) seen.set(row.idem_key, row);
  return Array.from(seen.values());
}

/**
 * GSC pages and queries can have legitimate dupes after canonicalization
 * (e.g., `?utm_source=linkedin` vs bare URL). Sum traffic and weight
 * position by impressions so the canonical row reflects total demand.
 */
function aggregateByIdemKey(rows) {
  const groups = new Map();
  for (const row of rows) {
    const existing = groups.get(row.idem_key);
    if (!existing) {
      groups.set(row.idem_key, { ...row });
      continue;
    }
    const prevImp = Number(existing.impressions ?? 0);
    const newImp = Number(row.impressions ?? 0);
    const totalImp = prevImp + newImp;
    const merged = {
      ...existing,
      clicks: Number(existing.clicks ?? 0) + Number(row.clicks ?? 0),
      impressions: totalImp,
    };
    if (existing.position != null && row.position != null && totalImp > 0) {
      merged.position =
        (Number(existing.position) * prevImp + Number(row.position) * newImp) / totalImp;
    } else {
      merged.position = existing.position ?? row.position ?? null;
    }
    groups.set(row.idem_key, merged);
  }
  return Array.from(groups.values());
}

async function upsertChunked(supabase, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);
    const { error } = await supabase
      .from('content_analytics')
      .upsert(slice, { onConflict: 'idem_key', ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    inserted += slice.length;
  }
  return inserted;
}

export async function importGscChart(supabase, { rows }) {
  start('importGscChart', { count: rows.length });
  const upserts = dedupeByIdemKey(
    rows.map((r) => ({
      platform: 'blog',
      metric_kind: 'gsc_chart_daily',
      period_start: r.date,
      period_end: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
      raw_data: { ctr: r.ctr },
      idem_key: `gsc_chart_daily|${r.date}`,
    }))
  );
  const inserted = await upsertChunked(supabase, upserts);
  success('importGscChart', { inserted });
  return { inserted };
}

export async function importGscPages(supabase, { rows, periodStart, periodEnd }) {
  start('importGscPages', { count: rows.length, periodStart, periodEnd });
  const urls = Array.from(new Set(rows.map((r) => r.url)));
  const urlToDraft = new Map();
  if (urls.length) {
    const { data, error } = await supabase
      .from('published_posts_index')
      .select('draft_id, published_url')
      .in('published_url', urls);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        urlToDraft.set(canonicalizeUrl(row.published_url), row.draft_id);
      }
    }
  }
  const upserts = aggregateByIdemKey(
    rows.map((r) => ({
      draft_id: urlToDraft.get(r.url) ?? null,
      platform: 'blog',
      metric_kind: 'gsc_page',
      url: r.url,
      period_start: periodStart,
      period_end: periodEnd,
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
      raw_data: { ctr: r.ctr, raw_url: r.rawUrl },
      idem_key: `gsc_page|${periodStart}|${periodEnd}|${r.url}`,
    }))
  );
  const inserted = await upsertChunked(supabase, upserts);
  const attributed = upserts.filter((u) => u.draft_id).length;
  success('importGscPages', { inserted, attributed });
  return { inserted, attributed };
}

export async function importGscQueries(supabase, { rows, periodStart, periodEnd }) {
  start('importGscQueries', { count: rows.length, periodStart, periodEnd });
  const upserts = aggregateByIdemKey(
    rows.map((r) => ({
      platform: 'blog',
      metric_kind: 'gsc_query',
      query: r.query,
      period_start: periodStart,
      period_end: periodEnd,
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
      raw_data: { ctr: r.ctr },
      idem_key: `gsc_query|${periodStart}|${periodEnd}|${r.query.toLowerCase()}`,
    }))
  );
  const inserted = await upsertChunked(supabase, upserts);
  success('importGscQueries', { inserted });
  return { inserted };
}

export async function importLinkedInPosts(supabase, { rows, periodStart, periodEnd }) {
  start('importLinkedInPosts', { count: rows.length, periodStart, periodEnd });
  const urns = Array.from(
    new Set(rows.map((r) => urnFromLinkedInUrl(r.url)).filter(Boolean))
  );
  const urnToDraft = new Map();
  if (urns.length) {
    const { data, error } = await supabase
      .from('content_drafts')
      .select('id, linkedin_post_id')
      .in('linkedin_post_id', urns);
    if (!error && Array.isArray(data)) {
      for (const row of data) urnToDraft.set(row.linkedin_post_id, row.id);
    }
  }
  const upserts = dedupeByIdemKey(
    rows.map((r) => {
      const urn = urnFromLinkedInUrl(r.url);
      return {
        draft_id: urn ? (urnToDraft.get(urn) ?? null) : null,
        platform: 'linkedin',
        metric_kind: 'linkedin_post',
        url: r.url || null,
        period_start: periodStart,
        period_end: periodEnd,
        clicks: r.clicks,
        impressions: r.impressions,
        engagements: (r.reactions ?? 0) + (r.comments ?? 0) + (r.shares ?? 0),
        shares: r.shares,
        comments: r.comments,
        raw_data: {
          title: r.title,
          posted_date: r.postedDate,
          reactions: r.reactions,
          engagement_rate: r.engagementRate,
          urn,
        },
        idem_key: `linkedin_post|${periodStart}|${periodEnd}|${urn ?? r.url}`,
      };
    })
  );
  const inserted = await upsertChunked(supabase, upserts);
  const attributed = upserts.filter((u) => u.draft_id).length;
  success('importLinkedInPosts', { inserted, attributed });
  return { inserted, attributed };
}

const KIND_REQUIRES_PERIOD = new Set(['gsc_pages', 'gsc_queries', 'linkedin_posts']);

export async function importAnalyticsCsv(supabase, { kind, csvText, periodStart, periodEnd }) {
  start('importAnalyticsCsv', { kind, periodStart, periodEnd });
  if (KIND_REQUIRES_PERIOD.has(kind) && (!periodStart || !periodEnd)) {
    throw new Error(`${kind} requires periodStart and periodEnd (YYYY-MM-DD)`);
  }
  try {
    let result;
    let parsedCount = 0;
    switch (kind) {
      case 'gsc_chart': {
        const rows = parseGscChartCsv(csvText);
        parsedCount = rows.length;
        result = await importGscChart(supabase, { rows });
        break;
      }
      case 'gsc_pages': {
        const rows = parseGscPagesCsv(csvText);
        parsedCount = rows.length;
        result = await importGscPages(supabase, { rows, periodStart, periodEnd });
        break;
      }
      case 'gsc_queries': {
        const rows = parseGscQueriesCsv(csvText);
        parsedCount = rows.length;
        result = await importGscQueries(supabase, { rows, periodStart, periodEnd });
        break;
      }
      case 'linkedin_posts': {
        const rows = parseLinkedInPostsCsv(csvText);
        parsedCount = rows.length;
        result = await importLinkedInPosts(supabase, { rows, periodStart, periodEnd });
        break;
      }
      default:
        throw new Error(`Unknown analytics kind: ${kind}`);
    }
    success('importAnalyticsCsv', { kind, parsed: parsedCount, ...result });
    return { kind, parsed: parsedCount, ...result };
  } catch (err) {
    fail('importAnalyticsCsv', err, { kind });
    throw err;
  }
}
