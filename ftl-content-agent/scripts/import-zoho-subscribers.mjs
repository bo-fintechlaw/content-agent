#!/usr/bin/env node
/**
 * Import Zoho / compliance-report CSV into subscribers as unconfirmed.
 *
 * Usage:
 *   node scripts/import-zoho-subscribers.mjs <path-to.csv>
 *
 * Expected columns (flexible header match):
 *   - email / Email / Email Address / Subscriber Email
 *   - segment (optional)
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve('ftl-content-agent/.env') });
dotenv.config({ override: true });

const EMAIL_HEADERS = ['email', 'email address', 'subscriber email', 'contact email'];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const emailIdx = headers.findIndex((h) => EMAIL_HEADERS.includes(h));
  if (emailIdx < 0) {
    throw new Error(`No email column found. Headers: ${headers.join(', ')}`);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const email = (cols[emailIdx] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    rows.push({ email, raw: cols });
  }
  return rows;
}

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

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/import-zoho-subscribers.mjs <csv-path>');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} email rows from ${csvPath}`);

  const supabase = createClient(url, key);
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const { data: existing } = await supabase
      .from('subscribers')
      .select('id')
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
        segments: ['financial_services', 'tech_ai_legal'],
      })
      .select('id')
      .single();
    if (subErr) {
      console.error(`Failed ${row.email}: ${subErr.message}`);
      continue;
    }

    await supabase.from('subscription_events').insert({
      subscriber_id: sub.id,
      event_type: 'imported',
      consent_text: 'Imported from Zoho export; pending double opt-in re-permission',
      source: 'import-zoho-subscribers.mjs',
      metadata: { csv_path: csvPath },
    });
    inserted++;
  }

  console.log(JSON.stringify({ inserted, skipped, total: rows.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
