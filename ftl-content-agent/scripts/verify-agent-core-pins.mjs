#!/usr/bin/env node
/**
 * verify-agent-core-pins @ 0.2.2
 * Reads vendor/ftl-agent-core/package.json and validates content-agent contracts.
 *
 * Usage (from ftl-content-agent/):
 *   node scripts/verify-agent-core-pins.mjs
 */
export const VERIFY_AGENT_CORE_PINS_VERSION = '0.2.2';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const vendorPkgPath = path.join(appRoot, 'vendor/ftl-agent-core/package.json');

function readText(relFromApp) {
  return fs.readFileSync(path.join(appRoot, relFromApp), 'utf8');
}

function fail(message) {
  console.error(`verify-agent-core-pins@${VERIFY_AGENT_CORE_PINS_VERSION}: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(vendorPkgPath)) {
  fail(`missing vendor manifest: ${vendorPkgPath}`);
}

const vendorPkg = JSON.parse(fs.readFileSync(vendorPkgPath, 'utf8'));
const pinProtocol = vendorPkg?.ftl?.verifyAgentCorePins;
if (pinProtocol !== VERIFY_AGENT_CORE_PINS_VERSION) {
  fail(
    `vendor pin protocol ${String(pinProtocol)} != expected ${VERIFY_AGENT_CORE_PINS_VERSION}`
  );
}

const pins = vendorPkg?.ftl?.agents?.content;
if (!pins) {
  fail('vendor/ftl-agent-core/package.json missing ftl.agents.content pins');
}

const interfaceDoc = readText('INTERFACE.md');
const newsletterTasks = readText('src/routes/newsletter-tasks.js');
const cmoSlack = readText('src/integrations/cmo-newsletter-slack.js');
const applyMigrations = readText('scripts/apply-newsletter-migrations.mjs');
const roadmap = readText('FTL_Pipeline_Roadmap_v1.md');

const errors = [];

if (!interfaceDoc.includes(`Agent ID: \`${pins.agent_id}\``)) {
  errors.push(`INTERFACE.md missing agent id ${pins.agent_id}`);
}

for (const [kind, spec] of Object.entries(pins.task_kinds ?? {})) {
  if (!interfaceDoc.includes(`### \`${kind}\``)) {
    errors.push(`INTERFACE.md missing task kind ${kind}`);
  }
  const routeSuffix = spec.route.replace(/^\/api/, '');
  if (!newsletterTasks.includes(routeSuffix)) {
    errors.push(`newsletter-tasks.js missing route ${spec.route}`);
  }
}

for (const [kind, spec] of Object.entries(pins.action_kinds ?? {})) {
  if (!roadmap.includes(kind)) {
    errors.push(`roadmap missing action kind ${kind}`);
  }
  if (!roadmap.includes(spec.autonomy_ceiling)) {
    errors.push(`roadmap missing autonomy ceiling ${spec.autonomy_ceiling} for ${kind}`);
  }
}

for (const actionId of pins.slack_action_ids ?? []) {
  if (!cmoSlack.includes(`'${actionId}'`)) {
    errors.push(`cmo-newsletter-slack.js missing Slack action id ${actionId}`);
  }
}

for (const migration of pins.fleet_migrations ?? []) {
  if (!applyMigrations.includes(migration)) {
    errors.push(`apply-newsletter-migrations.mjs missing fleet migration ${migration}`);
  }
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  fail(`${errors.length} pin mismatch(es)`);
}

console.log(`verify-agent-core-pins@${VERIFY_AGENT_CORE_PINS_VERSION}: ok (agent-core ${vendorPkg.version})`);
