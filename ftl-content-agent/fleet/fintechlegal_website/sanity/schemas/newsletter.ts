/**
 * Sanity newsletter document type — copy into fintechlegal_website Sanity Studio.
 */
export default {
  name: 'newsletter',
  title: 'Newsletter Issue',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule) => Rule.required() },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' },
      validation: (Rule) => Rule.required(),
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
    { name: 'panels', title: 'Panels', type: 'array', of: [{ type: 'object', fields: [
      { name: 'kind', type: 'string' },
      { name: 'headline', type: 'string' },
      { name: 'dek', type: 'string' },
      { name: 'body', type: 'text' },
      { name: 'blog_url', type: 'url' },
    ]}] },
    { name: 'footerDisclaimer', title: 'Footer Disclaimer', type: 'text' },
    { name: 'subscribeUrl', title: 'Subscribe URL', type: 'url' },
  ],
};
