#!/usr/bin/env node
/**
 * Smoke-test Sanity remote MCP (Streamable HTTP, same transport as src/mcp/mcpManager.ts).
 *
 * Usage (from ftl-content-agent/, with .env):
 *   npm run sanity:mcp:test
 *   npm run sanity:mcp:test -- --smoke
 * Env:
 *   SANITY_MCP_URL (default https://mcp.sanity.io)
 *   SANITY_MCP_AUTH_TOKEN or SANITY_API_TOKEN (Bearer; Editor token typical for dev)
 *   SANITY_PROJECT_ID, SANITY_DATASET (required for --smoke query_documents)
 */
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_URL = 'https://mcp.sanity.io';

function normalizeSanityMcpUrl(urlString) {
  const trimmed = String(urlString).trim();
  if (!trimmed) {
    throw new Error('SANITY_MCP_URL is empty');
  }
  return new URL(trimmed).toString();
}

function bearerToken() {
  const dedicated = process.env.SANITY_MCP_AUTH_TOKEN?.trim();
  if (dedicated) return dedicated;
  const api = process.env.SANITY_API_TOKEN?.trim();
  if (api) return api;
  return '';
}

function buildRequestInit(authToken) {
  if (!authToken) {
    console.error(
      'Missing Bearer: set SANITY_MCP_AUTH_TOKEN or SANITY_API_TOKEN in .env'
    );
    process.exit(1);
  }
  return {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  };
}

function parseArgs(argv) {
  let url = process.env.SANITY_MCP_URL?.trim() || DEFAULT_URL;
  let smoke = false;
  let callName = null;
  let callJson = '{}';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) {
      url = argv[++i];
      continue;
    }
    if (a === '--smoke') {
      smoke = true;
      continue;
    }
    if (a === '--call' && argv[i + 1]) {
      callName = argv[++i];
      continue;
    }
    if (a === '--json' && argv[i + 1]) {
      callJson = argv[++i];
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { help: true };
    }
  }
  return { url, smoke, callName, callJson, help: false };
}

function printToolResult(result) {
  const blocks = result.content ?? [];
  for (const item of blocks) {
    if (item.type === 'text' && typeof item.text === 'string') {
      console.log(item.text);
    } else {
      console.log(JSON.stringify(item, null, 2));
    }
  }
  if (result.isError) {
    console.error('(server marked tool result as error)');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`test-sanity-mcp.mjs — Sanity remote MCP (Streamable HTTP)

Options:
  --url <url>     MCP endpoint (default: SANITY_MCP_URL or ${DEFAULT_URL})
  --smoke         Call query_documents count(*) (needs SANITY_PROJECT_ID + SANITY_DATASET)
  --call <name>   Call a tool by exact server name (e.g. query_documents)
  --json '<obj>'  JSON arguments for --call (default {})
`);
    process.exit(0);
  }

  const mcpUrl = normalizeSanityMcpUrl(opts.url);
  const token = bearerToken();

  console.log('Connecting to Sanity MCP (Streamable HTTP)...');
  console.log('URL:', mcpUrl);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: buildRequestInit(token),
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 5,
    },
  });

  const client = new Client(
    { name: 'ftl-sanity-mcp-test', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  try {
    const listed = await client.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema
    );
    const names = (listed.tools ?? []).map((t) => t.name);
    console.log('tools/list count:', names.length);
    console.log('Sample tool names:', names.slice(0, 15).join(', '));

    if (opts.smoke) {
      const projectId = process.env.SANITY_PROJECT_ID?.trim();
      const dataset = process.env.SANITY_DATASET?.trim();
      if (!projectId || !dataset) {
        console.error(
          '\n--smoke requires SANITY_PROJECT_ID and SANITY_DATASET in .env (same as the app).'
        );
        process.exit(1);
      }
      const qd = names.includes('query_documents') ? 'query_documents' : null;
      if (!qd) {
        console.warn('No query_documents tool in list; skip smoke call');
      } else {
        console.log('\nCalling query_documents (smoke: count(*))...');
        const result = await client.callTool(
          {
            name: qd,
            arguments: {
              resource: { projectId, dataset },
              query: 'count(*)',
            },
          },
          CallToolResultSchema
        );
        printToolResult(result);
      }
    }

    if (opts.callName) {
      let args;
      try {
        args = JSON.parse(opts.callJson);
      } catch (e) {
        console.error('Invalid --json:', e.message);
        process.exit(1);
      }
      console.log(`\nCalling ${opts.callName}...`);
      const result = await client.callTool(
        { name: opts.callName, arguments: args },
        CallToolResultSchema
      );
      printToolResult(result);
    }
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
