import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Subset of validated app config used for Notion MCP (from `config/env.js`). */
export interface NotionMcpEnvSlice {
  NOTION_MCP_URL: string;
  NOTION_MCP_AUTH_TOKEN?: string;
}

/** Optional Sanity remote MCP (Streamable HTTP); uses same Bearer as Sanity API when set. */
export interface McpEnvSlice extends NotionMcpEnvSlice {
  SANITY_MCP_URL?: string;
  SANITY_API_TOKEN?: string;
}

const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 2000;

const DEFAULT_SANITY_MCP_URL = 'https://mcp.sanity.io';

let notionClient: Client | null = null;
let sanityClient: Client | null = null;

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
    notionClient = c;
  } catch (e) {
    await c.close().catch(() => {});
    await t.close().catch(() => {});
    throw e;
  }
}

function normalizeSanityMcpUrl(urlString: string): string {
  const trimmed = urlString.trim();
  if (!trimmed) {
    throw new Error('SANITY_MCP_URL is empty');
  }
  return new URL(trimmed).toString();
}

async function connectSanityOnce(env: McpEnvSlice): Promise<void> {
  const token = env.SANITY_API_TOKEN?.trim();
  if (!token) {
    return;
  }
  const urlRaw = env.SANITY_MCP_URL?.trim() || DEFAULT_SANITY_MCP_URL;
  const url = normalizeSanityMcpUrl(urlRaw);
  const t = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: buildRequestInit(token),
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 5,
    },
  });

  const c = new Client(
    { name: 'ftl-sanity-mcp', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await c.connect(t);
    sanityClient = c;
  } catch (e) {
    await c.close().catch(() => {});
    await t.close().catch(() => {});
    throw e;
  }
}

/**
 * Connect to Notion MCP (2 attempts) and, when `SANITY_API_TOKEN` is set, Sanity MCP (1 attempt).
 */
export async function initializeMcpConnections(env: McpEnvSlice): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(RETRY_BASE_DELAY_MS);
      }
      await connectOnce(env);
      console.log('MCP connected: notion');
      break;
    } catch (e) {
      lastErr = e;
      await disconnectNotion();
    }
  }
  if (!notionClient) {
    console.warn(
      '[MCP] Notion MCP not available (server down or NOTION_MCP_URL misconfigured):',
      lastErr instanceof Error ? lastErr.message : lastErr
    );
  }

  if (env.SANITY_API_TOKEN?.trim()) {
    try {
      await connectSanityOnce(env);
      console.log('MCP connected: sanity');
    } catch (e) {
      console.warn(
        '[MCP] Sanity MCP not available (SANITY_MCP_URL or token issue):',
        e instanceof Error ? e.message : e
      );
    }
  }
}

/**
 * Active MCP client, or throws if {@link initializeMcpConnections} did not succeed.
 */
export function getNotionClient(): Client {
  if (!notionClient) {
    throw new Error(
      'Notion MCP client is not connected; call initializeMcpConnections() first'
    );
  }
  return notionClient;
}

export function isNotionMcpConnected(): boolean {
  return notionClient !== null;
}

/**
 * Active Sanity MCP client, or throws if remote MCP did not connect.
 */
export function getSanityClient(): Client {
  if (!sanityClient) {
    throw new Error(
      'Sanity MCP client is not connected; ensure SANITY_API_TOKEN is set and initializeMcpConnections() succeeded for Sanity'
    );
  }
  return sanityClient;
}

export function isSanityMcpConnected(): boolean {
  return sanityClient !== null;
}

async function disconnectNotion(): Promise<void> {
  const c = notionClient;
  notionClient = null;
  if (c) {
    await c.close().catch(() => {});
  }
}

export async function disconnectAll(): Promise<void> {
  await disconnectNotion();
  const s = sanityClient;
  sanityClient = null;
  if (s) {
    await s.close().catch(() => {});
  }
}
