import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getDefaultNotionMcpConnectionManager } from './connection-manager.js';
import {
  NOTION_TOOL,
  notionCreateCommentArgsSchema,
  notionCreateDatabaseArgsSchema,
  notionCreatePagesArgsSchema,
  notionCreateViewArgsSchema,
  notionDuplicatePageArgsSchema,
  notionFetchArgsSchema,
  notionGetCommentsArgsSchema,
  notionGetSelfArgsSchema,
  notionGetTeamsArgsSchema,
  notionGetUserArgsSchema,
  notionGetUsersArgsSchema,
  notionMovePagesArgsSchema,
  notionQueryDatabaseViewArgsSchema,
  notionQueryDataSourcesArgsSchema,
  notionSearchArgsSchema,
  notionUpdateDataSourceArgsSchema,
  notionUpdatePageArgsSchema,
  notionUpdateViewArgsSchema,
} from './notion-schemas.js';

/**
 * @param {import('@modelcontextprotocol/sdk/types.js').CallToolResult} result
 * @returns {string}
 */
export function textFromCallToolResult(result) {
  if (!result?.content?.length) {
    return '';
  }
  return result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Typed helper around {@link import('@modelcontextprotocol/sdk/client').Client} for Notion MCP tools.
 */
export class NotionMcpClient {
  /**
   * @param {import('./connection-manager.js').NotionMcpConnectionManager} manager
   */
  constructor(manager) {
    this.manager = manager;
  }

  /**
   * @returns {Promise<z.infer<typeof ListToolsResultSchema>>}
   */
  async listTools() {
    const client = await this.manager.getClient();
    const raw = await client.listTools();
    return ListToolsResultSchema.parse(raw);
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {z.ZodTypeAny} [argsSchema] — when set, `args` are validated before the RPC
   * @param {z.ZodTypeAny} [structuredSchema] — when set and `structuredContent` is present, it is parsed
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult & { structuredContent?: unknown }>}
   */
  async callTool(name, args, argsSchema, structuredSchema) {
    const payload =
      argsSchema !== undefined ? argsSchema.parse(args) : args ?? {};
    const client = await this.manager.getClient();
    const result = await client.callTool(
      { name, arguments: payload },
      CallToolResultSchema
    );

    if (structuredSchema && result.structuredContent !== undefined) {
      const parsed = structuredSchema.safeParse(result.structuredContent);
      if (!parsed.success) {
        const msg = parsed.error?.message ?? String(parsed.error);
        throw new Error(
          `NotionMcpClient: structuredContent for "${name}" failed validation: ${msg}`
        );
      }
      return { ...result, structuredContent: parsed.data };
    }

    return result;
  }

  /**
   * @param {string | z.infer<typeof notionSearchArgsSchema>} queryOrArgs
   */
  async search(queryOrArgs) {
    const args =
      typeof queryOrArgs === 'string'
        ? { query: queryOrArgs }
        : notionSearchArgsSchema.parse(queryOrArgs);
    return this.callTool(NOTION_TOOL.SEARCH, args, notionSearchArgsSchema);
  }

  /** @param {z.infer<typeof notionFetchArgsSchema>} args */
  async fetch(args) {
    return this.callTool(
      NOTION_TOOL.FETCH,
      args,
      notionFetchArgsSchema
    );
  }

  /** @param {z.infer<typeof notionCreatePagesArgsSchema>} args */
  async createPages(args) {
    return this.callTool(
      NOTION_TOOL.CREATE_PAGES,
      args,
      notionCreatePagesArgsSchema
    );
  }

  /** @param {z.infer<typeof notionUpdatePageArgsSchema>} args */
  async updatePage(args) {
    return this.callTool(
      NOTION_TOOL.UPDATE_PAGE,
      args,
      notionUpdatePageArgsSchema
    );
  }

  /** @param {z.infer<typeof notionMovePagesArgsSchema>} args */
  async movePages(args) {
    return this.callTool(
      NOTION_TOOL.MOVE_PAGES,
      args,
      notionMovePagesArgsSchema
    );
  }

  /** @param {z.infer<typeof notionDuplicatePageArgsSchema>} args */
  async duplicatePage(args) {
    return this.callTool(
      NOTION_TOOL.DUPLICATE_PAGE,
      args,
      notionDuplicatePageArgsSchema
    );
  }

  /** @param {z.infer<typeof notionCreateDatabaseArgsSchema>} args */
  async createDatabase(args) {
    return this.callTool(
      NOTION_TOOL.CREATE_DATABASE,
      args,
      notionCreateDatabaseArgsSchema
    );
  }

  /** @param {z.infer<typeof notionUpdateDataSourceArgsSchema>} args */
  async updateDataSource(args) {
    return this.callTool(
      NOTION_TOOL.UPDATE_DATA_SOURCE,
      args,
      notionUpdateDataSourceArgsSchema
    );
  }

  /** @param {z.infer<typeof notionCreateViewArgsSchema>} args */
  async createView(args) {
    return this.callTool(
      NOTION_TOOL.CREATE_VIEW,
      args,
      notionCreateViewArgsSchema
    );
  }

  /** @param {z.infer<typeof notionUpdateViewArgsSchema>} args */
  async updateView(args) {
    return this.callTool(
      NOTION_TOOL.UPDATE_VIEW,
      args,
      notionUpdateViewArgsSchema
    );
  }

  /** @param {z.infer<typeof notionQueryDataSourcesArgsSchema>} args */
  async queryDataSources(args) {
    return this.callTool(
      NOTION_TOOL.QUERY_DATA_SOURCES,
      args,
      notionQueryDataSourcesArgsSchema
    );
  }

  /** @param {z.infer<typeof notionQueryDatabaseViewArgsSchema>} args */
  async queryDatabaseView(args) {
    return this.callTool(
      NOTION_TOOL.QUERY_DATABASE_VIEW,
      args,
      notionQueryDatabaseViewArgsSchema
    );
  }

  /** @param {z.infer<typeof notionCreateCommentArgsSchema>} args */
  async createComment(args) {
    return this.callTool(
      NOTION_TOOL.CREATE_COMMENT,
      args,
      notionCreateCommentArgsSchema
    );
  }

  /** @param {z.infer<typeof notionGetCommentsArgsSchema>} args */
  async getComments(args) {
    return this.callTool(
      NOTION_TOOL.GET_COMMENTS,
      args,
      notionGetCommentsArgsSchema
    );
  }

  /** @param {z.infer<typeof notionGetTeamsArgsSchema>} [args] */
  async getTeams(args = {}) {
    return this.callTool(
      NOTION_TOOL.GET_TEAMS,
      args,
      notionGetTeamsArgsSchema
    );
  }

  /** @param {z.infer<typeof notionGetUsersArgsSchema>} [args] */
  async getUsers(args = {}) {
    return this.callTool(
      NOTION_TOOL.GET_USERS,
      args,
      notionGetUsersArgsSchema
    );
  }

  /** @param {z.infer<typeof notionGetUserArgsSchema>} args */
  async getUser(args) {
    return this.callTool(
      NOTION_TOOL.GET_USER,
      args,
      notionGetUserArgsSchema
    );
  }

  /** @param {z.infer<typeof notionGetSelfArgsSchema>} [args] */
  async getSelf(args = {}) {
    return this.callTool(
      NOTION_TOOL.GET_SELF,
      args,
      notionGetSelfArgsSchema
    );
  }
}

/**
 * @param {import('./connection-manager.js').NotionMcpConnectionManager} [manager]
 * @returns {NotionMcpClient}
 */
export function createNotionMcpClient(manager) {
  return new NotionMcpClient(
    manager ?? getDefaultNotionMcpConnectionManager()
  );
}
