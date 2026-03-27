import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { fail, start, success } from '../utils/logger.js';

const breaker = new CircuitBreaker('x');

export function createXOAuth({ consumerKey, consumerSecret, accessToken, accessTokenSecret }) {
  start('createXOAuth');
  const ck = String(consumerKey ?? '').trim();
  const cs = String(consumerSecret ?? '').trim();
  const at = String(accessToken ?? '').trim();
  const ats = String(accessTokenSecret ?? '').trim();

  if (!ck || !cs) throw new Error('Missing X_API_KEY or X_API_SECRET');
  if (!at || !ats) throw new Error('Missing X_ACCESS_TOKEN or X_ACCESS_TOKEN_SECRET');

  const oauth = new OAuth({
    consumer: { key: ck, secret: cs },
    signature_method: 'HMAC-SHA1',
    hash_function: (baseString, key) =>
      crypto.createHmac('sha1', key).update(baseString).digest('base64'),
  });

  success('createXOAuth');
  return oauth;
}

/**
 * Creates a tweet (optionally as a reply).
 * @param {object} params
 * @param {string} params.consumerKey
 * @param {string} params.consumerSecret
 * @param {string} params.accessToken
 * @param {string} params.accessTokenSecret
 * @param {string} params.text
 * @param {string} [params.inReplyToTweetId]
 */
export async function postXTweet({
  consumerKey,
  consumerSecret,
  accessToken,
  accessTokenSecret,
  text,
  inReplyToTweetId,
}) {
  start('postXTweet');

  const oauth = createXOAuth({ consumerKey, consumerSecret, accessToken, accessTokenSecret });

  const url = 'https://api.twitter.com/2/tweets';
  const body = {
    text: String(text ?? '').slice(0, 280),
  };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: String(inReplyToTweetId) };
  }

  const token = { key: String(accessToken), secret: String(accessTokenSecret) };

  // OAuth 1.0a signature does not automatically include JSON body fields in most implementations,
  // but it typically still works for Twitter when signing just the OAuth request parameters.
  const requestData = { url, method: 'POST' };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const result = await breaker.execute(
    async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(`X API error: ${json?.title ?? resp.status}`);
      }
      return json;
    },
    { error: 'x_unavailable' }
  );

  if (result?.error) {
    const err = new Error(String(result.error));
    fail('postXTweet', err);
    throw err;
  }

  const id = result?.data?.id;
  if (!id) {
    const err = new Error('X tweet created but no id returned');
    fail('postXTweet', err, { response: result });
    throw err;
  }

  success('postXTweet', { id });
  return { id };
}

