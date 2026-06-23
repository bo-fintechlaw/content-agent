#!/usr/bin/env node
/**
 * Import Zoho / compliance-report CSV into fleet subscribers as unconfirmed.
 *
 * Usage:
 *   node scripts/import-zoho-subscribers.mjs <path-to.csv> [--dry-run]
 *
 * Recognized email columns:
 *   Email Address, Contact Email, contact_email, Subscriber Email, email, ...
 *
 * Optional segment column (Segment, List Name, Mailing List):
 *   financial_services | tech_ai_legal | both (default for ComplianceUpdatesFTL)
 *
 * Rows with status unsubscribed/opt-out/bounced/spam are skipped when a status column exists.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ override: true });

const EMAIL_HEADERS = [
  'email',
  'email address',
  'subscriber email',
  'subscriber email address',
  'contact email',
  'contact_email',
  'contactemailaddress',
];

const SEGMENT_HEADERS = ['segment', 'list name', 'mailing list', 'list', 'audience'];
const STATUS_HEADERS = ['status', 'contact status', 'subscription status', 'email status'];

const SKIP_STATUS = new Set([
  'unsubscribed',
  'unsubscribe',
  'opt-out',
  'opt out',
  'optout',
  'bounced',
  'hard bounce',
  'soft bounce',
  'spam',
  'complaint',
  'suppressed',
  'inactive',
  'removed',
]);

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/^"|"$/g, '').trim());
}

/** @param {string} raw */
function normalizeSegments(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return ['financial_services'];
  if (value === 'both' || value.includes('both')) {
    return ['financial_services', 'tech_ai_legal'];
  }
  if (
    value.includes('startup') ||
    value.includes('tech') ||
    value.includes('ai') ||
    value.includes('legal engineering')
  ) {
    return ['tech_ai_legal'];
  }
  if (
    value.includes('financial') ||
    value.includes('compliance') ||
    value.includes('edge') ||
    value.includes('ftl')
  ) {
    return ['financial_services'];
  }
  return ['financial_services'];
}

/**
 * @param {string} text
 * @param {string} csvPath
 */
function parseCsv(text, csvPath) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const emailIdx = headers.findIndex((h) => EMAIL_HEADERS.includes(h));
  if (emailIdx < 0) {
    throw new Error(`No email column found. Headers: ${headers.join(', ')}`);
  }

  const segmentIdx = headers.findIndex((h) => SEGMENT_HEADERS.includes(h));
  const statusIdx = headers.findIndex((h) => STATUS_HEADERS.includes(h));
  const defaultSegments = csvPath.toLowerCase().includes('compliance')
    ? ['financial_services']
    : ['financial_services', 'tech_ai_legal'];

  const seen = new Set();
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const email = (cols[emailIdx] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);

    if (statusIdx >= 0) {
      const status = String(cols[statusIdx] ?? '').trim().toLowerCase();
      if (SKIP_STATUS.has(status)) continue;
    }

    const segmentRaw = segmentIdx >= 0 ? cols[segmentIdx] : '';
    const segments = segmentRaw ? normalizeSegments(segmentRaw) : defaultSegments;
    rows.push({ email, segments });
  }

  return { headers, rows };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) {
    console.error('Usage: node scripts/import-zoho-subscribers.mjs <csv-path> [--dry-run]');
    process.exit(1);
  }

  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const url = process.env.SUPABASE_FLEET_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_FLEET_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('SUPABASE_FLEET_URL and SUPABASE_FLEET_SERVICE_KEY required (or legacy SUPABASE_*)');
    process.exit(1);
  }

  const text = fs.readFileSync(resolved, 'utf8');
  const { headers, rows } = parseCsv(text, resolved);
  console.log(`CSV headers: ${headers.join(', ')}`);
  console.log(`Parsed ${rows.length} importable email rows from ${resolved}`);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          sample: rows.slice(0, 5),
          segment_counts: rows.reduce((acc, r) => {
            const key = r.segments.join('+');
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        },
        null,
        2
      )
    );
    return;
  }

  const supabase = createClient(url, key);
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const { data: existing } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('email', row.email)
      .maybeSingle();

    if (existing?.id) {
      skipped++;
      continue;
    }

    const { data: sub, error: subErr } = await supabase
      .from('subscribers')
      .insert({
        email: row.email,
        status: 'unconfirmed',
        source: 'imported-from-zoho',
        segments: row.segments,
      })
      .select('id')
      .single();

    if (subErr) {
      console.error(`Failed ${row.email}: ${subErr.message}`);
      failed++;
      continue;
    }

    await supabase.from('subscription_events').insert({
      subscriber_id: sub.id,
      event_type: 'imported',
      consent_text: 'Imported from Zoho ComplianceUpdates export; pending double opt-in re-permission',
      source: 'import-zoho-subscribers.mjs',
      metadata: { csv_path: resolved, segments: row.segments },
    });
    inserted++;
  }

  console.log(JSON.stringify({ inserted, skipped, failed, total: rows.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
