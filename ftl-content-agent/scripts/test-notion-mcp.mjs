#!/usr/bin/env node
/**
 * Smoke-test Notion MCP over Streamable HTTP (same transport as src/mcp/mcpManager.ts).
 *
 * Prerequisite: Notion MCP server listening (e.g. npx @notionhq/notion-mcp-server with HTTP on 3100).
 *
 * Usage (from ftl-content-agent/, with .env):
 *   npm run notion:mcp:test
 *   npm run notion:mcp:test -- --url http://127.0.0.1:3100/mcp
 *   npm run notion:mcp:test -- --smoke
 *   npm run notion:mcp:test -- --call notion-search --json '{"query":"meeting"}'
 *
 * Env: NOTION_MCP_URL (default http://127.0.0.1:3100/mcp), NOTION_MCP_AUTH_TOKEN (optional Bearer).
 */
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_URL = 'http://127.0.0.1:3100/mcp';

function normalizeMcpUrl(urlString) {
  const trimmed = String(urlString).trim();
  if (!trimmed) {
    throw new Error('MCP URL is empty');
  }
  const u = new URL(trimmed);
  if (!u.pathname || u.pathname === '/') {
    u.pathname = '/mcp';
  }
  return u.toString();
}

function buildRequestInit(authToken) {
  if (!authToken?.trim()) {
    return undefined;
  }
  return {
    headers: {
      Authorization: `Bearer ${authToken.trim()}`,
    },
  };
}

function parseArgs(argv) {
  let url = process.env.NOTION_MCP_URL?.trim() || DEFAULT_URL;
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

function pickWorkspaceMapTool(names) {
  const preferred = ['notion_get_workspace_map', 'notion-get-workspace-map'];
  for (const p of preferred) {
    if (names.includes(p)) return p;
  }
  return names.find(
    (n) =>
      /workspace/i.test(n) && /map/i.test(n) && /notion/i.test(n)
  );
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
    console.log(`test-notion-mcp.mjs — Streamable HTTP MCP smoke test

Options:
  --url <url>     MCP endpoint (default: NOTION_MCP_URL or ${DEFAULT_URL})
  --smoke         After listing tools, call workspace-map tool if found
  --call <name>   Call a tool by exact server name
  --json '<obj>'  JSON arguments for --call (default {})
`);
    process.exit(0);
  }

  const mcpUrl = normalizeMcpUrl(opts.url);
  const auth = process.env.NOTION_MCP_AUTH_TOKEN?.trim() ?? '';

  console.log('Connecting to Notion MCP (Streamable HTTP)...');
  console.log('  URL:', mcpUrl);
  console.log('  Auth:', auth ? 'Bearer ***' : '(none)');

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: buildRequestInit(auth),
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 3,
    },
  });

  const client = new Client(
    { name: 'ftl-content-agent-notion-mcp-test', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log('Connected.\n');

    const toolsResult = await client.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema
    );

    const tools = toolsResult.tools ?? [];
    console.log(`Tools available (${tools.length}):`);
    for (const t of tools) {
      const line = t.description
        ? `  • ${t.name} — ${t.description.split('\n')[0]}`
        : `  • ${t.name}`;
      console.log(line);
    }

    let toCall = opts.callName;
    if (opts.smoke && !toCall) {
      const names = tools.map((t) => t.name);
      toCall = pickWorkspaceMapTool(names);
      if (toCall) {
        console.log(`\n--smoke: calling ${toCall} ...\n`);
      } else {
        console.log(
          '\n--smoke: no workspace-map tool found; pass --call <name> explicitly.'
        );
      }
    } else if (toCall) {
      console.log(`\nCalling ${toCall} ...\n`);
    }

    if (toCall) {
      let args = {};
      try {
        args = JSON.parse(opts.callJson);
      } catch (e) {
        console.error('Invalid --json:', e.message);
        process.exit(1);
      }
      const callResult = await client.request(
        {
          method: 'tools/call',
          params: { name: toCall, arguments: args },
        },
        CallToolResultSchema
      );
      printToolResult(callResult);
    }

    console.log('\nDone.');
  } catch (e) {
    console.error(
      '\nMCP connection or request failed:',
      e instanceof Error ? e.message : e
    );
    console.error(
      '\nCheck: server running, URL path is /mcp, firewall, and NOTION_MCP_AUTH_TOKEN if required.'
    );
    process.exit(1);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

main();
