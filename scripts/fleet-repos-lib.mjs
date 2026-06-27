#!/usr/bin/env node
/** Shared fleet repo list — single source for bootstrap, mirror, protection scripts. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = join(dirname(fileURLToPath(import.meta.url)), "fleet-repos.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

/** @returns {string[]} short repo names */
export function fleetSecretRepos() {
  return config.secrets;
}

/** @returns {string[]} full owner/name */
export function fleetFullRepos() {
  return config.secrets.map((name) => `bo-fintechlaw/${name}`);
}

/** @returns {{ repo: string; profile: string; agentId?: string }[]} */
export function fleetMirrorPeers() {
  return config.mirror;
}
