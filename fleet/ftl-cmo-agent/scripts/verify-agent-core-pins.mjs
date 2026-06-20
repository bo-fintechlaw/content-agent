#!/usr/bin/env node
/**
 * verify-agent-core-pins @ 0.2.2
 * Reads vendor/ftl-agent-core/package.json and validates repo agent pins.
 *
 * Usage:
 *   REPO_AGENT_ID=content node scripts/verify-agent-core-pins.mjs
 */
export const VERIFY_AGENT_CORE_PINS_VERSION = '0.2.2';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const vendorPkgPath = path.join(appRoot, 'vendor/ftl-agent-core/package.json');

function fail(message) {
  console.error(`verify-agent-core-pins@${VERIFY_AGENT_CORE_PINS_VERSION}: ${message}`);
  process.exit(1);
}

function resolveAgentId() {
  if (process.env.REPO_AGENT_ID) return process.env.REPO_AGENT_ID;
  const localPkgPath = path.join(appRoot, 'package.json');
  if (fs.existsSync(localPkgPath)) {
    const localPkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf8'));
    if (localPkg.ftl?.agentId) return localPkg.ftl.agentId;
  }
  fail('set REPO_AGENT_ID or package.json ftl.agentId');
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

const agentId = resolveAgentId();
const pins = vendorPkg?.ftl?.agents?.[agentId];
if (!pins) {
  fail(`vendor/ftl-agent-core/package.json missing ftl.agents.${agentId}`);
}

console.log(
  `verify-agent-core-pins@${VERIFY_AGENT_CORE_PINS_VERSION}: ok (agent=${agentId}, agent-core ${vendorPkg.version})`
);
