/**
 * Select published posts for newsletter features by segment.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {'financial_services' | 'tech_ai_legal'} segment
 * @param {{ limit?: number }} options
 */
export async function selectBlogPostsForSegment(supabase, segment, options = {}) {
  const limit = options.limit ?? 3;
  const categories =
    segment === 'financial_services'
      ? ['financial_services', 'regulatory', 'crypto', 'fintech']
      : ['ai_legal_tech', 'legal_engineering', 'startup'];

  const { data, error } = await supabase
    .from('published_posts_index')
    .select('draft_id, blog_title, blog_slug, published_url, category, first_paragraph, published_at')
    .in('category', categories)
    .order('published_at', { ascending: false })
    .limit(limit * 3);

  if (error) throw new Error(error.message);

  const seen = new Set();
  const picked = [];
  for (const row of data ?? []) {
    if (!row.published_url || seen.has(row.blog_slug)) continue;
    seen.add(row.blog_slug);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}
