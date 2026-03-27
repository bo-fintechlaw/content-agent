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

