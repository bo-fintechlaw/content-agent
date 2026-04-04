import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_MCP_URL = 'http://localhost:3100/mcp';

/**
 * Lazily connects (and reconnects) to a Notion MCP server over Streamable HTTP.
 *
 * Environment (used by {@link NotionMcpConnectionManager.fromEnv}):
 * - `NOTION_MCP_URL` — MCP endpoint (default {@link DEFAULT_MCP_URL})
 * - `NOTION_MCP_AUTH_TOKEN` — optional `Authorization: Bearer …` for HTTP transport
 */
export class NotionMcpConnectionManager {
  /**
   * @param {{
   *   url?: string;
   *   authToken?: string;
   *   clientName?: string;
   *   clientVersion?: string;
   *   requestInit?: RequestInit;
   * }} [options]
   */
  constructor(options = {}) {
    this.url = options.url ?? DEFAULT_MCP_URL;
    this.authToken = options.authToken?.trim() || undefined;
    this.clientName = options.clientName ?? 'ftl-content-agent';
    this.clientVersion = options.clientVersion ?? '1.0.0';
    this.baseRequestInit = options.requestInit;

    /** @type {import('@modelcontextprotocol/sdk/client').Client | null} */
    this._client = null;
    /** @type {StreamableHTTPClientTransport | null} */
    this._transport = null;
    /** @type {Promise<void> | null} */
    this._pendingConnect = null;
  }

  /**
   * @returns {NotionMcpConnectionManager}
   */
  static fromEnv() {
    return new NotionMcpConnectionManager({
      url: process.env.NOTION_MCP_URL?.trim() || DEFAULT_MCP_URL,
      authToken: process.env.NOTION_MCP_AUTH_TOKEN?.trim() || undefined,
    });
  }

  /**
   * @returns {RequestInit}
   */
  _mergedRequestInit() {
    const headers = new Headers(this.baseRequestInit?.headers);
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }
    return { ...this.baseRequestInit, headers };
  }

  _invalidate(reason, err) {
    if (err) {
      console.warn('[NotionMcpConnectionManager] transport error:', err);
    } else if (reason) {
      console.warn('[NotionMcpConnectionManager] transport closed:', reason);
    }
    this._client = null;
    this._transport = null;
  }

  /**
   * @returns {Promise<import('@modelcontextprotocol/sdk/client').Client>}
   */
  async getClient() {
    if (this._client) {
      return this._client;
    }
    if (!this._pendingConnect) {
      this._pendingConnect = this._connect().finally(() => {
        this._pendingConnect = null;
      });
    }
    await this._pendingConnect;
    if (!this._client) {
      throw new Error('NotionMcpConnectionManager: connect failed without error');
    }
    return this._client;
  }

  async _connect() {
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: this._mergedRequestInit(),
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 5,
      },
    });

    transport.onclose = () => this._invalidate('close');
    transport.onerror = (err) => this._invalidate('error', err);

    const client = new Client(
      { name: this.clientName, version: this.clientVersion },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
    } catch (e) {
      await transport.close().catch(() => {});
      throw e;
    }

    this._transport = transport;
    this._client = client;
  }

  /**
   * Closes the MCP session and clears cached client state.
   */
  async close() {
    const c = this._client;
    this._client = null;
    this._transport = null;
    if (c) {
      await c.close().catch(() => {});
    }
  }
}

let _defaultManager;

/**
 * Process-wide default manager (reads `NOTION_MCP_URL` / `NOTION_MCP_AUTH_TOKEN`).
 * @returns {NotionMcpConnectionManager}
 */
export function getDefaultNotionMcpConnectionManager() {
  if (!_defaultManager) {
    _defaultManager = NotionMcpConnectionManager.fromEnv();
  }
  return _defaultManager;
}
