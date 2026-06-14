#!/usr/bin/env node
/**
 * Apply newsletter migrations 015 + 016 to fleet Supabase.
 * Requires: npx supabase linked to project wrxuyabngyaiujgcfexj
 *
 * Usage:
 *   node scripts/apply-newsletter-migrations.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const files = [
  'src/db/migrations/015_newsletter_domain.sql',
  'src/db/migrations/016_newsletter_rls.sql',
  '../../../ftl-agent-core/migrations/0005_newsletter_action_kinds.sql',
];

for (const rel of files) {
  const file = path.join(root, rel);
  console.log(`Applying ${rel}...`);
  const result = spawnSync(
    'npx',
    ['--yes', 'supabase', 'db', 'query', '--linked', '--file', file],
    { stdio: 'inherit', cwd: root }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${rel}`);
    process.exit(result.status ?? 1);
  }
}

console.log('Newsletter migrations applied.');
