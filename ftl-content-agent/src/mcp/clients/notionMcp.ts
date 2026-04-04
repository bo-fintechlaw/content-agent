import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getNotionClient } from '../mcpManager.js';

/** Official Notion remote MCP tool names use `notion-` + kebab-case. */
const NOTION_SEARCH = 'notion-search';
const NOTION_FETCH = 'notion-fetch';
const NOTION_CREATE_PAGES = 'notion-create-pages';
const NOTION_QUERY_DATABASE_VIEW = 'notion-query-database-view';
const NOTION_UPDATE_PAGE = 'notion-update-page';

export type NotionJson =
  | string
  | number
  | boolean
  | null
  | NotionJson[]
  | { [key: string]: NotionJson };

const looseRecord = z.record(z.string(), z.unknown());

export type NotionToolTypedResult<T> =
  | { ok: true; data: T; text: string; isError: boolean }
  | { ok: false; rawText: string; isError: boolean };

/** MCP tool results may be `content` blocks or legacy `toolResult` shapes. */
function textFromCallToolResult(result: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  const parts = result.content ?? [];
  return parts
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c.type === 'text' && typeof c.text === 'string'
    )
    .map((c) => c.text)
    .join('\n');
}

function parseJsonFromText<T>(text: string): T | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function callNotionToolTyped<T>(
  name: string,
  args: Record<string, unknown>
): Promise<NotionToolTypedResult<T>> {
  const mcp = getNotionClient();
  const result = await mcp.callTool(
    { name, arguments: args },
    CallToolResultSchema
  );
  const text = textFromCallToolResult(
    result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
  );
  const isError = Boolean(
    (result as { isError?: boolean }).isError
  );
  const parsed = parseJsonFromText<T>(text);
  if (parsed !== null) {
    return { ok: true, data: parsed, text, isError };
  }
  return { ok: false, rawText: text, isError };
}

export async function searchNotion(
  query: string
): Promise<NotionToolTypedResult<NotionJson>> {
  return callNotionToolTyped<NotionJson>(NOTION_SEARCH, { query });
}

export async function getPage(
  pageId: string
): Promise<NotionToolTypedResult<NotionJson>> {
  return callNotionToolTyped<NotionJson>(NOTION_FETCH, { id: pageId });
}

export type NotionCreatePageParams = Record<string, unknown>;

export async function createPage(
  params: NotionCreatePageParams
): Promise<NotionToolTypedResult<NotionJson>> {
  looseRecord.parse(params);
  return callNotionToolTyped<NotionJson>(NOTION_CREATE_PAGES, params);
}

export type NotionQueryDatabaseParams = {
  database_id: string;
  filter?: NotionJson;
  sorts?: NotionJson;
  page_size?: number;
};

export async function queryDatabase(
  params: NotionQueryDatabaseParams
): Promise<NotionToolTypedResult<NotionJson>> {
  const args: Record<string, unknown> = {
    database_id: params.database_id,
  };
  if (params.filter !== undefined) args.filter = params.filter;
  if (params.sorts !== undefined) args.sorts = params.sorts;
  if (params.page_size !== undefined) args.page_size = params.page_size;
  return callNotionToolTyped<NotionJson>(
    NOTION_QUERY_DATABASE_VIEW,
    args
  );
}

export type NotionCreateDatabaseEntryParams = {
  database_id: string;
  properties: Record<string, unknown>;
};

export async function createDatabaseEntry(
  params: NotionCreateDatabaseEntryParams
): Promise<NotionToolTypedResult<NotionJson>> {
  const payload: Record<string, unknown> = {
    parent: { database_id: params.database_id },
    properties: params.properties,
  };
  return callNotionToolTyped<NotionJson>(NOTION_CREATE_PAGES, payload);
}

export type NotionUpdatePagePropertiesParams = {
  page_id: string;
  properties: Record<string, unknown>;
};

export async function updatePageProperties(
  params: NotionUpdatePagePropertiesParams
): Promise<NotionToolTypedResult<NotionJson>> {
  const payload: Record<string, unknown> = {
    page_id: params.page_id,
    properties: params.properties,
  };
  return callNotionToolTyped<NotionJson>(NOTION_UPDATE_PAGE, payload);
}
