import axios from 'axios';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('linkedin');

export function createLinkedInClient(accessToken) {
  start('createLinkedInClient');
  if (!accessToken) throw new Error('Missing LINKEDIN_ACCESS_TOKEN');
  const token = String(accessToken).trim();
  if (!token) throw new Error('Missing LINKEDIN_ACCESS_TOKEN');
  success('createLinkedInClient');
  return token;
}

/**
 * Posts a UGC "text-only" share (shareMediaCategory = NONE).
 * @param {object} params
 * @param {string} params.accessToken
 * @param {string} params.personUrn
 * @param {string} params.text
 */
export async function postLinkedInUgc({ accessToken, personUrn, text }) {
  start('postLinkedInUgc');
  const clientToken = createLinkedInClient(accessToken);

  const urn = String(personUrn ?? '').trim();
  if (!urn) throw new Error('Missing LINKEDIN_PERSON_URN');

  const message = String(text ?? '').trim();
  if (!message) throw new Error('Missing LinkedIn post text');

  const url = 'https://api.linkedin.com/v2/ugcPosts';

  // LinkedIn expects the nested `com.linkedin.ugc.ShareContent` field name.
  const requestBody = {
    author: urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: message },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const result = await breaker.execute(
    () => axios.post(url, requestBody, { headers: { Authorization: `Bearer ${clientToken}` } }),
    { data: { id: null }, error: 'linkedin_unavailable' }
  );

  if (result?.error) {
    const err = new Error(String(result.error));
    fail('postLinkedInUgc', err);
    throw err;
  }

  const id = result?.data?.id ?? null;
  if (!id) {
    const err = new Error('LinkedIn post succeeded but no id returned');
    fail('postLinkedInUgc', err, { response: result?.data });
    throw err;
  }

  success('postLinkedInUgc', { id });
  return { id };
}

/**
 * Upload carousel images and publish a multi-image UGC post.
 * Falls back to text-only via caller on failure.
 * @param {object} params
 * @param {string} params.accessToken
 * @param {string} params.personUrn
 * @param {string} params.text
 * @param {string[]} params.imageUrls
 */
export async function postLinkedInCarousel({ accessToken, personUrn, text, imageUrls }) {
  start('postLinkedInCarousel', { imageCount: imageUrls?.length ?? 0 });
  const clientToken = createLinkedInClient(accessToken);
  const urn = String(personUrn ?? '').trim();
  if (!urn) throw new Error('Missing LINKEDIN_PERSON_URN');

  const urls = (imageUrls ?? []).filter(Boolean).slice(0, 9);
  if (!urls.length) throw new Error('No carousel images provided');

  const assetUrns = [];
  for (const imageUrl of urls) {
    const assetUrn = await registerAndUploadImage(clientToken, urn, imageUrl);
    assetUrns.push(assetUrn);
  }

  const message = String(text ?? '').trim();
  const requestBody = {
    author: urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: message },
        shareMediaCategory: 'IMAGE',
        media: assetUrns.map((asset) => ({
          status: 'READY',
          media: asset,
        })),
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const result = await breaker.execute(
    () =>
      axios.post('https://api.linkedin.com/v2/ugcPosts', requestBody, {
        headers: {
          Authorization: `Bearer ${clientToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }),
    { data: { id: null }, error: 'linkedin_carousel_unavailable' }
  );

  if (result?.error) {
    const err = new Error(String(result.error));
    fail('postLinkedInCarousel', err);
    throw err;
  }

  const id = result?.data?.id ?? null;
  if (!id) throw new Error('LinkedIn carousel post succeeded but no id returned');

  success('postLinkedInCarousel', { id, images: assetUrns.length });
  return { id };
}

/** @param {string} accessToken @param {string} ownerUrn @param {string} imageUrl */
async function registerAndUploadImage(accessToken, ownerUrn, imageUrl) {
  const registerRes = await axios.post(
    'https://api.linkedin.com/v2/assets?action=registerUpload',
    {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: ownerUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    }
  );

  const uploadUrl =
    registerRes.data?.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;
  const asset = registerRes.data?.value?.asset;
  if (!uploadUrl || !asset) {
    throw new Error('LinkedIn registerUpload missing uploadUrl or asset');
  }

  const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  await axios.put(uploadUrl, imageRes.data, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
  });

  return asset;
}

