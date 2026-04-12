import {
  Client,
  isFullDataSource,
  isFullDatabase,
  type DataSourceObjectResponse,
} from '@notionhq/client';
import { TtlCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const SCHEMA_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CompactProperty {
  name: string;
  type: string;
}

export interface DatabaseSchema {
  id: string;
  title: string;
  url: string;
  properties: Record<string, CompactProperty>;
}

export const schemaCache = new TtlCache<DatabaseSchema>('schema', {
  ttlMs: SCHEMA_TTL_MS,
});

function extractTitle(titleArray: Array<{ plain_text?: string }>): string {
  if (!Array.isArray(titleArray)) return '';
  return titleArray.map((t) => t.plain_text || '').join('');
}

export function normalizeDataSource(ds: DataSourceObjectResponse): DatabaseSchema {
  const properties: Record<string, CompactProperty> = {};
  if (ds.properties) {
    for (const [name, prop] of Object.entries(ds.properties)) {
      const cfg = prop as { type: string };
      properties[name] = { name, type: cfg.type };
    }
  }
  return {
    id: ds.id,
    title: extractTitle(ds.title),
    url: ds.url || '',
    properties,
  };
}

export async function getDataSourceSchema(
  notion: Client,
  dataSourceId: string
): Promise<DatabaseSchema> {
  const cached = schemaCache.get(dataSourceId);
  if (cached) return cached;

  logger.info('Fetching data source schema from Notion', { dataSourceId });
  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

  if (isFullDataSource(ds)) {
    const schema = normalizeDataSource(ds);
    schemaCache.set(dataSourceId, schema);
    return schema;
  }

  return { id: ds.id, title: '', url: '', properties: {} };
}

export async function getDatabaseSchema(
  notion: Client,
  databaseId: string
): Promise<DatabaseSchema> {
  const cached = schemaCache.get(databaseId);
  if (cached) return cached;

  logger.info('Fetching database from Notion', { databaseId });
  const database = await notion.databases.retrieve({ database_id: databaseId });

  if (!isFullDatabase(database)) {
    return { id: database.id, title: '', url: '', properties: {} };
  }

  if (!database.data_sources?.length) {
    const schema: DatabaseSchema = {
      id: database.id,
      title: extractTitle(database.title),
      url: database.url || '',
      properties: {},
    };
    schemaCache.set(databaseId, schema);
    return schema;
  }

  const schema = await getDataSourceSchema(notion, database.data_sources[0].id);
  schemaCache.set(databaseId, schema);
  return schema;
}
