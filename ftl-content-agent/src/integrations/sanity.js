import crypto from 'crypto';
import { createClient } from '@sanity/client';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';
import { blogSectionsToMainContent } from '../utils/portable-text.js';
import { generateAndUploadImage } from './image-generator.js';

const breaker = new CircuitBreaker('sanity');

export function createSanityClient(config) {
  start('createSanityClient', {
    projectId: config.SANITY_PROJECT_ID,
    dataset: config.SANITY_DATASET,
  });

  try {
    const client = createClient({
      projectId: config.SANITY_PROJECT_ID,
      dataset: config.SANITY_DATASET,
      // Newer Sanity API versions are required for Action-based workflows (publish actions).
      apiVersion: '2025-02-19',
      useCdn: false,
      // Needed to reliably query draft ids like `drafts.<id>`.
      perspective: 'raw',
      token: config.SANITY_API_TOKEN,
    });

    success('createSanityClient');
    return client;
  } catch (error) {
    fail('createSanityClient', error);
    throw error;
  }
}

export function buildBlogDocument(draft) {
  const mainContent = blogSectionsToMainContent(draft.blog_body);

  return {
    _type: 'blog',
    title: draft.blog_title,
    slug: { _type: 'slug', current: draft.blog_slug },
    publishedAt: new Date().toISOString(),
    shareImage: {
      _type: 'image',
      instruction: draft.image_prompt,
    },
    blogImageAlt: draft.blog_title,
    seoTitle: draft.blog_seo_title,
    seoDescription: draft.blog_seo_description,
    seoKeywords: draft.blog_seo_keywords,
    noindex: false,
    nofollow: false,
    blogTags: draft.blog_tags,
    category: draft.blog_category,
    mainContent,
  };
}
export async function createAndPublishBlogFromDraft({
  client,
  config,
  draft,
  timeoutMs = 30000,
  pollIntervalMs = 2000,
  generateImage = true,
  publishAfterCreate = true,
}) {
  start('createAndPublishBlogFromDraft', { draftId: draft?.id });

  // Create as explicit draft so we can publish via `client.action`.
  const baseId = crypto.randomBytes(10).toString('hex');
  const draftDocId = `drafts.${baseId}`;
  const publishedId = baseId;

  const blogDoc = { ...buildBlogDocument(draft), _id: draftDocId };

  const created = await breaker.execute(() => client.create(blogDoc));
  if (created?.error) throw new Error(String(created.error));
  // Ensure the draft exists before attempting publish.
  const draftExists = await client.fetch(`*[_id==$draftDocId][0]._id`, { draftDocId });
  if (!draftExists) {
    throw new Error(`Sanity draft not found after create: ${draftDocId}`);
  }

  let imageReady = false;
  if (generateImage && draft.image_prompt && !config.XAI_API_KEY) {
    start('createAndPublishBlogFromDraft:skipImage', {
      reason:
        'XAI_API_KEY or GROK_API_KEY not set (api.x.ai) — not the same as Twitter X_API_KEY',
    });
  } else if (generateImage && draft.image_prompt && config.XAI_API_KEY) {
    try {
      const slugPart = (draft.blog_slug || 'blog').slice(0, 40);
      const assetRef = await generateAndUploadImage({
        prompt: draft.image_prompt,
        sanityClient: client,
        xaiApiKey: config.XAI_API_KEY,
        filename: `${slugPart}.png`,
      });

      if (assetRef) {
        // Patch the draft document with the generated image asset
        await client
          .patch(draftDocId)
          .set({ shareImage: { _type: 'image', asset: assetRef } })
          .commit();
        imageReady = true;
        success('createAndPublishBlogFromDraft:imageGeneration', { assetRef });
      }
    } catch (e) {
      // Non-fatal — publish without image
      fail('createAndPublishBlogFromDraft:imageGeneration', e);
    }
  }

  if (publishAfterCreate) {
    const publishRes = await breaker.execute(() =>
      client.action({
        actionType: 'sanity.action.document.publish',
        draftId: draftDocId,
        publishedId,
      })
    );
    if (publishRes?.error) throw new Error(String(publishRes.error));
  }

  success('createAndPublishBlogFromDraft', {
    docId: publishedId,
    imageReady,
    published: publishAfterCreate,
  });
  return { docId: publishedId, imageReady, published: publishAfterCreate };
}

/**
 * Rebuilds `mainContent` from a draft’s `blog_body` and patches an **already published** blog document.
 * Use after improving markdown in the draft (e.g. headings and lists) so the site picks up new Portable Text.
 * @param {import('@sanity/client').SanityClient} client
 * @param {string} publishedId  Sanity _id of the published document (not `drafts.…`)
 * @param {any[]} blogBody  Same shape as `content_drafts.blog_body`
 */
export async function patchPublishedBlogMainContent(client, publishedId, blogBody) {
  start('patchPublishedBlogMainContent', { publishedId, sections: blogBody?.length });
  const mainContent = blogSectionsToMainContent(blogBody);
  const res = await breaker.execute(() =>
    client.patch(publishedId).set({ mainContent }).commit()
  );
  if (res?.error) {
    const err = new Error(String(res.error));
    fail('patchPublishedBlogMainContent', err, { publishedId });
    throw err;
  }
  success('patchPublishedBlogMainContent', { publishedId });
  return { publishedId };
}

/**
 * Generate a featured image with Grok Imagine and set `shareImage` on a **published** blog document.
 * Use for backfill when the initial publish had no `XAI_API_KEY` or generation failed.
 * @param {import('@sanity/client').SanityClient} client
 * @param {Record<string, any>} config  Must include `XAI_API_KEY`
 * @param {{ publishedId: string, imagePrompt: string, blogSlug?: string }} params
 */
export async function patchPublishedShareImage(client, config, params) {
  const { publishedId, imagePrompt, blogSlug = 'blog' } = params;
  start('patchPublishedShareImage', { publishedId });
  if (!config.XAI_API_KEY?.trim()) {
    const err = new Error('XAI_API_KEY or GROK_API_KEY is not set (xAI, not X/Twitter keys)');
    fail('patchPublishedShareImage', err);
    throw err;
  }
  if (!String(imagePrompt ?? '').trim()) {
    const err = new Error('image_prompt is empty');
    fail('patchPublishedShareImage', err);
    throw err;
  }
  const slugPart = String(blogSlug).slice(0, 40);
  const assetRef = await generateAndUploadImage({
    prompt: imagePrompt,
    sanityClient: client,
    xaiApiKey: config.XAI_API_KEY,
    filename: `${slugPart}.png`,
  });
  if (!assetRef) {
    const err = new Error('Grok image generation did not return an asset');
    fail('patchPublishedShareImage', err);
    throw err;
  }
  const res = await breaker.execute(() =>
    client
      .patch(publishedId)
      .set({ shareImage: { _type: 'image', asset: assetRef } })
      .commit()
  );
  if (res?.error) {
    const err = new Error(String(res.error));
    fail('patchPublishedShareImage:commit', err, { publishedId });
    throw err;
  }
  success('patchPublishedShareImage', { publishedId });
  return { publishedId, assetRef };
}

