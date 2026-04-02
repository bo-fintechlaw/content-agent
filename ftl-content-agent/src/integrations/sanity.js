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
  if (generateImage && draft.image_prompt && config.XAI_API_KEY) {
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

