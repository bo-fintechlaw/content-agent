import { z } from 'zod';

/**
 * Official Notion MCP tool names (remote server).
 * @see https://developers.notion.com/docs/mcp-supported-tools
 */
export const NOTION_TOOL = {
  SEARCH: 'notion-search',
  FETCH: 'notion-fetch',
  CREATE_PAGES: 'notion-create-pages',
  UPDATE_PAGE: 'notion-update-page',
  MOVE_PAGES: 'notion-move-pages',
  DUPLICATE_PAGE: 'notion-duplicate-page',
  CREATE_DATABASE: 'notion-create-database',
  UPDATE_DATA_SOURCE: 'notion-update-data-source',
  CREATE_VIEW: 'notion-create-view',
  UPDATE_VIEW: 'notion-update-view',
  QUERY_DATA_SOURCES: 'notion-query-data-sources',
  QUERY_DATABASE_VIEW: 'notion-query-database-view',
  CREATE_COMMENT: 'notion-create-comment',
  GET_COMMENTS: 'notion-get-comments',
  GET_TEAMS: 'notion-get-teams',
  GET_USERS: 'notion-get-users',
  GET_USER: 'notion-get-user',
  GET_SELF: 'notion-get-self',
};

/** Loose args: known optional fields + passthrough for server-specific keys. */
export const notionSearchArgsSchema = z
  .object({
    query: z.string().optional(),
  })
  .passthrough();

export const notionFetchArgsSchema = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

export const notionCreatePagesArgsSchema = z.record(z.string(), z.unknown());

export const notionUpdatePageArgsSchema = z.record(z.string(), z.unknown());

export const notionMovePagesArgsSchema = z.record(z.string(), z.unknown());

export const notionDuplicatePageArgsSchema = z.record(z.string(), z.unknown());

export const notionCreateDatabaseArgsSchema = z.record(z.string(), z.unknown());

export const notionUpdateDataSourceArgsSchema = z.record(
  z.string(),
  z.unknown()
);

export const notionCreateViewArgsSchema = z.record(z.string(), z.unknown());

export const notionUpdateViewArgsSchema = z.record(z.string(), z.unknown());

export const notionQueryDataSourcesArgsSchema = z.record(
  z.string(),
  z.unknown()
);

export const notionQueryDatabaseViewArgsSchema = z.record(
  z.string(),
  z.unknown()
);

export const notionCreateCommentArgsSchema = z.record(z.string(), z.unknown());

export const notionGetCommentsArgsSchema = z.record(z.string(), z.unknown());

export const notionGetTeamsArgsSchema = z.record(z.string(), z.unknown());

export const notionGetUsersArgsSchema = z.record(z.string(), z.unknown());

export const notionGetUserArgsSchema = z.record(z.string(), z.unknown());

export const notionGetSelfArgsSchema = z.record(z.string(), z.unknown());

/** When the server returns `structuredContent`, validate with this unless you pass a stricter schema. */
export const notionStructuredPayloadSchema = z.record(z.string(), z.unknown());
