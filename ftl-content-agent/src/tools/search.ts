import { Client, isFullDataSource } from '@notionhq/client';
import {
  schemaCache,
  normalizeDataSource,
  getDataSourceSchema,
} from './databases.js';
import type { DatabaseSchema } from './databases.js';
import { logger } from '../utils/logger.js';

export interface WorkspaceMapEntry {
  id: string;
  title: string;
  url: string;
  properties: Record<string, string>; // name → type
}

export interface WorkspaceMap {
  databases: WorkspaceMapEntry[];
  generated_at: string;
}

function toMapEntry(schema: DatabaseSchema): WorkspaceMapEntry {
  const compactProps: Record<string, string> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    compactProps[name] = prop.type;
  }
  return {
    id: schema.id,
    title: schema.title,
    url: schema.url,
    properties: compactProps,
  };
}

export async function getWorkspaceMap(notion: Client): Promise<WorkspaceMap> {
  logger.info('Building workspace map');

  const searchResult = await notion.search({
    filter: { value: 'data_source', property: 'object' },
    page_size: 100,
  });

  const entries: WorkspaceMapEntry[] = [];

  for (const result of searchResult.results) {
    if (result.object !== 'data_source') continue;

    let schema: DatabaseSchema;

    if (isFullDataSource(result)) {
      schema = normalizeDataSource(result);
      schemaCache.set(result.id, schema);
    } else {
      schema = await getDataSourceSchema(notion, result.id);
    }

    entries.push(toMapEntry(schema));
  }

  logger.info('Workspace map complete', { databaseCount: entries.length });

  return {
    databases: entries,
    generated_at: new Date().toISOString(),
  };
}
