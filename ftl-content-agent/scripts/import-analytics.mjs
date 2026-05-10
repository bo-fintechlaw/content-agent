#!/usr/bin/env node
/**
 * Import analytics CSVs into content_analytics.
 *
 * Usage:
 *   # Bulk import a GSC export folder (auto-detects Chart.csv, Pages.csv, Queries.csv)
 *   node scripts/import-analytics.mjs gsc-folder <path-to-folder> [period_start] [period_end]
 *
 *   # Single file
 *   node scripts/import-analytics.mjs gsc_chart    <file>
 *   node scripts/import-analytics.mjs gsc_pages    <file> <period_start> <period_end>
 *   node scripts/import-analytics.mjs gsc_queries  <file> <period_start> <period_end>
 *   node scripts/import-analytics.mjs linkedin_posts <file> <period_start> <period_end>
 *
 * Period dates are YYYY-MM-DD. For gsc-folder, the period defaults to the
 * earliest and latest date found in Chart.csv if not provided.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSupabaseClient } from '../src/db/supabase.js';
import {
  importAnalyticsCsv,
  parseGscChartCsv,
} from '../src/pipeline/analytics-import.js';

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    `Usage:
  node scripts/import-analytics.mjs gsc-folder <folder> [period_start] [period_end]
  node scripts/import-analytics.mjs <kind> <file> [period_start] [period_end]

kinds: gsc_chart, gsc_pages, gsc_queries, linkedin_posts
period dates: YYYY-MM-DD (required for gsc_pages, gsc_queries, linkedin_posts)`
  );
  process.exit(1);
}

async function main() {
  const [mode, target, periodStartArg, periodEndArg] = process.argv.slice(2);
  if (!mode || !target) usage();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) usage('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in env');

  const supabase = createSupabaseClient(url, key);

  if (mode === 'gsc-folder') {
    await importGscFolder(supabase, target, periodStartArg, periodEndArg);
    return;
  }

  const csvText = await readFile(target, 'utf8');
  const result = await importAnalyticsCsv(supabase, {
    kind: mode,
    csvText,
    periodStart: periodStartArg ?? null,
    periodEnd: periodEndArg ?? null,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function importGscFolder(supabase, folder, periodStartArg, periodEndArg) {
  const chartPath = path.join(folder, 'Chart.csv');
  const pagesPath = path.join(folder, 'Pages.csv');
  const queriesPath = path.join(folder, 'Queries.csv');

  const chartCsv = await readFile(chartPath, 'utf8');
  const chartRows = parseGscChartCsv(chartCsv);
  if (!chartRows.length) {
    throw new Error(`Chart.csv parsed 0 rows: ${chartPath}`);
  }
  const dates = chartRows.map((r) => r.date).sort();
  const periodStart = periodStartArg ?? dates[0];
  const periodEnd = periodEndArg ?? dates[dates.length - 1];

  const results = {};
  results.gsc_chart = await importAnalyticsCsv(supabase, {
    kind: 'gsc_chart',
    csvText: chartCsv,
    periodStart: null,
    periodEnd: null,
  });
  results.gsc_pages = await importAnalyticsCsv(supabase, {
    kind: 'gsc_pages',
    csvText: await readFile(pagesPath, 'utf8'),
    periodStart,
    periodEnd,
  });
  results.gsc_queries = await importAnalyticsCsv(supabase, {
    kind: 'gsc_queries',
    csvText: await readFile(queriesPath, 'utf8'),
    periodStart,
    periodEnd,
  });

  console.log(JSON.stringify({ periodStart, periodEnd, ...results }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
