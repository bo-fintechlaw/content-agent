import { start, success, fail } from '../utils/logger.js';

const BUCKET = 'newsletter-carousel';

/**
 * Upload carousel PNG to Supabase storage and return public URL.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ slug: string, panelIndex: number, pngBuffer: Buffer }} opts
 * @returns {Promise<string>}
 */
export async function uploadCarouselPanel(supabase, { slug, panelIndex, pngBuffer }) {
  const path = `${slug}/panel-${panelIndex}.png`;
  start('uploadCarouselPanel', { path });

  const { error } = await supabase.storage.from(BUCKET).upload(path, pngBuffer, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) throw new Error(`carousel upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) throw new Error('carousel public URL unavailable');

  success('uploadCarouselPanel', { path, url });
  return url;
}

/**
 * Ensure the newsletter-carousel bucket exists (best-effort).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function ensureCarouselBucket(supabase) {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (buckets?.some((b) => b.name === BUCKET)) return;
    await supabase.storage.createBucket(BUCKET, { public: true });
  } catch (err) {
    fail('ensureCarouselBucket', err);
  }
}

export { BUCKET as NEWSLETTER_CAROUSEL_BUCKET };
