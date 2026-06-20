/**
 * Enrich feature panels with hero_image_url from Sanity blog shareImage.
 * @param {import('../schemas/newsletter.js').IssueJsonSchema['_output']} issue
 * @param {import('@sanity/client').SanityClient | null | undefined} sanityClient
 * @returns {Promise<import('../schemas/newsletter.js').IssueJsonSchema['_output']>}
 */
export async function enrichIssueWithHeroImages(issue, sanityClient) {
  if (!sanityClient) return issue;

  const out = structuredClone(issue);
  const features = out.panels.filter((p) => p.kind === 'feature');

  await Promise.all(
    features.map(async (panel) => {
      if (panel.hero_image_url) return;
      const slug = blogSlugFromUrl(panel.blog_url);
      if (!slug) return;

      try {
        const row = await sanityClient.fetch(
          `*[_type == "blog" && slug.current == $slug][0]{
            "heroImageUrl": shareImage.asset->url
          }`,
          { slug }
        );
        if (row?.heroImageUrl) {
          panel.hero_image_url = row.heroImageUrl;
        }
      } catch {
        // Non-fatal — render without hero image
      }
    })
  );

  return out;
}

/** @param {string} blogUrl */
function blogSlugFromUrl(blogUrl) {
  try {
    const u = new URL(blogUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const blogIdx = parts.indexOf('blog');
    if (blogIdx >= 0 && parts[blogIdx + 1]) return parts[blogIdx + 1];
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}
