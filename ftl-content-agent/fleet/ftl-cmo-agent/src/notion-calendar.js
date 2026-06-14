import { Client } from '@notionhq/client';

/**
 * Read the next due newsletter segment from Notion editorial calendar.
 * @param {string} databaseId
 * @param {string} token
 */
export async function getDueNewsletterSegment(databaseId, token) {
  if (!databaseId || !token) {
    return { segment: 'financial_services', source: 'default' };
  }

  const notion = new Client({ auth: token });
  const today = new Date().toISOString().slice(0, 10);

  const { results } = await notion.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        { property: 'Type', select: { equals: 'Newsletter' } },
        { property: 'Due Date', date: { on_or_before: today } },
        { property: 'Status', select: { does_not_equal: 'Published' } },
      ],
    },
    sorts: [{ property: 'Due Date', direction: 'ascending' }],
    page_size: 1,
  });

  if (!results?.length) {
    return { segment: 'financial_services', source: 'fallback_no_calendar_row' };
  }

  const page = results[0];
  const segmentProp =
    page.properties?.Segment?.select?.name ??
    page.properties?.segment?.select?.name ??
    'Financial Services';

  const segment = /startup|tech|ai/i.test(segmentProp)
    ? 'tech_ai_legal'
    : 'financial_services';

  return { segment, source: 'notion', pageId: page.id };
}
