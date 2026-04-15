import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { getSanityClient } from '../mcpManager.js';

const WHOAMI = 'whoami';
const QUERY_DOCUMENTS = 'query_documents';

/** MCP tool results may use `content` blocks. */
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

export type SanityToolResult = { text: string; isError: boolean };

async function callSanityTool(
  name: string,
  args: Record<string, unknown>
): Promise<SanityToolResult> {
  const mcp = getSanityClient();
  const result = await mcp.callTool(
    { name, arguments: args },
    CallToolResultSchema
  );
  const text = textFromCallToolResult(
    result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
  );
  const isError = Boolean((result as { isError?: boolean }).isError);
  return { text, isError };
}

/**
 * Sanity remote MCP `whoami` (user identity). Often requires a **personal** token;
 * project Editor tokens may error; use {@link sanityMcpQueryDocuments} to verify robot tokens.
 */
export async function sanityMcpWhoami(): Promise<SanityToolResult> {
  return callSanityTool(WHOAMI, {});
}

/** Target project + dataset (Sanity MCP `resource` on `query_documents`). */
export type SanityMcpContentResource = {
  projectId: string;
  dataset: string;
};

export type SanityQueryDocumentsParams = {
  resource: SanityMcpContentResource;
  query: string;
  params?: Record<string, unknown>;
  single?: boolean;
  limit?: number;
  perspective?: 'raw' | 'drafts' | 'published' | string;
  /** Optional; Sanity MCP uses this for product telemetry. */
  intent?: string;
};

/** Run a GROQ query via Sanity MCP (`query_documents`). */
export async function sanityMcpQueryDocuments(
  params: SanityQueryDocumentsParams
): Promise<SanityToolResult> {
  const args: Record<string, unknown> = {
    resource: {
      projectId: params.resource.projectId,
      dataset: params.resource.dataset,
    },
    query: params.query,
  };
  if (params.params !== undefined) args.params = params.params;
  if (params.single !== undefined) args.single = params.single;
  if (params.limit !== undefined) args.limit = params.limit;
  if (params.perspective !== undefined) args.perspective = params.perspective;
  if (params.intent !== undefined) args.intent = params.intent;
  return callSanityTool(QUERY_DOCUMENTS, args);
}
