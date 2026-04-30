import axios from 'axios';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('image-generator');

/**
 * Generate an image via xAI Grok Imagine and upload it to Sanity.
 * Returns the Sanity image asset reference, or null on failure (non-fatal).
 *
 * @param {object} params
 * @param {string} params.prompt - Image generation prompt
 * @param {import('@sanity/client').SanityClient} params.sanityClient
 * @param {string} params.xaiApiKey - xAI API key
 * @param {string} [params.filename]
 * @returns {Promise<{_type: 'reference', _ref: string} | null>}
 */
export async function generateAndUploadImage({ prompt, sanityClient, xaiApiKey, filename = 'blog-featured.png' }) {
  start('generateAndUploadImage');

  if (!xaiApiKey) {
    fail(
      'generateAndUploadImage',
      new Error('Set XAI_API_KEY (or GROK_API_KEY) for api.x.ai — not Twitter X_API_KEY')
    );
    return null;
  }

  try {
    // Generate image with Grok Imagine
    // xAI Grok Imagine: use `aspect_ratio` + `resolution` (not OpenAI’s `size` — wrong param caused failed generations).
    const imageResult = await breaker.execute(
      async () => {
        const resp = await axios.post(
          'https://api.x.ai/v1/images/generations',
          {
            model: 'grok-imagine-image',
            prompt: `Professional editorial illustration for a legal/fintech blog post. ${prompt}. Style: clean, modern, minimal. No text or words in the image.`,
            n: 1,
            aspect_ratio: '16:9',
            resolution: '2k',
            response_format: 'url',
          },
          {
            headers: {
              Authorization: `Bearer ${xaiApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        return resp.data;
      },
      null
    );

    if (!imageResult || imageResult.error) {
      const msg = imageResult?.error || 'xAI image request failed (no response body)';
      fail('generateAndUploadImage', new Error(String(msg)));
      return null;
    }

    const imageUrl = imageResult?.data?.[0]?.url;
    if (!imageUrl) {
      fail('generateAndUploadImage', new Error('No image URL returned from Grok Imagine'));
      return null;
    }

    // Download the image (URLs are temporary)
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Upload to Sanity
    const asset = await sanityClient.assets.upload('image', imageBuffer, {
      filename,
      contentType: 'image/png',
    });

    success('generateAndUploadImage', { assetId: asset._id });
    return { _type: 'reference', _ref: asset._id };
  } catch (error) {
    fail('generateAndUploadImage', error);
    return null;
  }
}
