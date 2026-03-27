import crypto from 'crypto';
import { createClient } from '@sanity/client';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';
import { blogSectionsToMainContent } from '../utils/portable-text.js';
import { generateShareImageWithAgentActions } from './sanity-agent-actions.js';

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
  if (generateImage && publishAfterCreate) {
    // Trigger image generation asynchronously (best-effort).
    // In some runtimes, Agent Actions aren't available, so this may fail.
    let agentActionOk = false;
    try {
      const imgRes = await generateShareImageWithAgentActions({
        client,
        schemaId: config.SANITY_SCHEMA_ID,
        documentId: publishedId,
        instruction: 'Generate a featured image based on the image prompt field.',
      });
      agentActionOk = !!imgRes?.ok;
    } catch (e) {
      fail('createAndPublishBlogFromDraft:imageGeneration', e);
    }

    // Poll until shareImage.asset exists (or timeout) before publishing.
    if (agentActionOk) {
      const maxWait = timeoutMs;
      let elapsed = 0;

      while (elapsed < maxWait && !imageReady) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        elapsed += pollIntervalMs;
        try {
          const share = await client.fetch(
            '*[_id==$draftDocId][0]{shareImage{asset{_ref}}}',
            { draftDocId }
          );
          imageReady = !!share?.shareImage?.asset?._ref;
        } catch {
          // Keep polling
        }
      }

      success('createAndPublishBlogFromDraft:poll', { imageReady });
    } else {
      // Avoid 30s polling when Agent Actions aren't available.
      success('createAndPublishBlogFromDraft:poll:skipped', { agentActionOk });
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

