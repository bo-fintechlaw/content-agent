/**
 * Sanity newsletter document type — copy into fintechlegal_website Sanity Studio.
 */
export default {
  name: 'newsletter',
  title: 'Newsletter Issue',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: { required: () => unknown }) => Rule.required() },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' },
      validation: (Rule: { required: () => unknown }) => Rule.required(),
    },
    { name: 'issueDate', title: 'Issue Date', type: 'date' },
    {
      name: 'segment',
      title: 'Segment',
      type: 'string',
      options: {
        list: [
          { title: 'Financial Services', value: 'financial_services' },
          { title: 'Tech & AI / Legal Engineering', value: 'tech_ai_legal' },
        ],
      },
    },
    { name: 'intro', title: 'From Bo Intro', type: 'text' },
    { name: 'toc', title: 'Table of Contents', type: 'array', of: [{ type: 'string' }] },
    {
      name: 'panels',
      title: 'Panels',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'kind', type: 'string' },
            { name: 'section_no', type: 'number' },
            { name: 'kicker', type: 'string' },
            { name: 'headline', type: 'string' },
            { name: 'dek', type: 'string' },
            { name: 'hero_image_url', type: 'url' },
            { name: 'pull_quote', type: 'string' },
            { name: 'blog_url', type: 'url' },
            { name: 'consultation_url', type: 'url' },
            { name: 'body', type: 'text' },
            {
              name: 'action_list',
              type: 'array',
              of: [{ type: 'string' }],
            },
            {
              name: 'stats',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'value', type: 'string' },
                    { name: 'label', type: 'string' },
                  ],
                },
              ],
            },
            {
              name: 'deadlines',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'date', type: 'string' },
                    { name: 'requirement', type: 'string' },
                  ],
                },
              ],
            },
            {
              name: 'litigation_watch',
              type: 'array',
              of: [{ type: 'string' }],
            },
            {
              name: 'groups',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'firm_type', type: 'string' },
                    { name: 'label', type: 'string' },
                    {
                      name: 'items',
                      type: 'array',
                      of: [{ type: 'string' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { name: 'authorName', title: 'Author Name', type: 'string' },
    { name: 'authorTitle', title: 'Author Title', type: 'string' },
    { name: 'footerDisclaimer', title: 'Footer Disclaimer', type: 'text' },
    { name: 'physicalAddress', title: 'Physical Address', type: 'string' },
    { name: 'subscribeUrl', title: 'Subscribe URL', type: 'url' },
  ],
};
