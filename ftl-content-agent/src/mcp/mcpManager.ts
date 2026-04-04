import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Subset of validated app config used for Notion MCP (from `config/env.js`). */
export interface NotionMcpEnvSlice {
  NOTION_MCP_URL: string;
  NOTION_MCP_AUTH_TOKEN?: string;
}

const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 2000;

let client: Client | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If the URL has no path (or only `/`), append `/mcp` for Streamable HTTP MCP.
 */
export function normalizeNotionMcpUrl(urlString: string): string {
  const trimmed = urlString.trim();
  if (!trimmed) {
    throw new Error('NOTION_MCP_URL is empty');
  }
  const u = new URL(trimmed);
  if (!u.pathname || u.pathname === '/') {
    u.pathname = '/mcp';
  }
  return u.toString();
}

function buildRequestInit(authToken?: string): RequestInit | undefined {
  if (!authToken?.trim()) {
    return undefined;
  }
  return {
    headers: {
      Authorization: `Bearer ${authToken.trim()}`,
    },
  };
}

async function connectOnce(env: NotionMcpEnvSlice): Promise<void> {
  const url = normalizeNotionMcpUrl(env.NOTION_MCP_URL);
  const t = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: buildRequestInit(env.NOTION_MCP_AUTH_TOKEN),
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 5,
    },
  });

  const c = new Client(
    { name: 'ftl-content-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await c.connect(t);
    client = c;
  } catch (e) {
    await c.close().catch(() => {});
    await t.close().catch(() => {});
    throw e;
  }
}

/**
 * Connect to the Notion MCP server (2 attempts, 2s delay between failures).
 */
export async function initializeMcpConnections(env: NotionMcpEnvSlice): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(RETRY_BASE_DELAY_MS);
      }
      await connectOnce(env);
      console.log('MCP connected: notion');
      return;
    } catch (e) {
      lastErr = e;
      await disconnectAll();
    }
  }
  console.warn(
    '[MCP] Notion MCP not available (server down or NOTION_MCP_URL misconfigured):',
    lastErr instanceof Error ? lastErr.message : lastErr
  );
}

/**
 * Active MCP client, or throws if {@link initializeMcpConnections} did not succeed.
 */
export function getNotionClient(): Client {
  if (!client) {
    throw new Error(
      'Notion MCP client is not connected; call initializeMcpConnections() first'
    );
  }
  return client;
}

export function isNotionMcpConnected(): boolean {
  return client !== null;
}

export async function disconnectAll(): Promise<void> {
  const c = client;
  client = null;
  if (c) {
    await c.close().catch(() => {});
  }
}
