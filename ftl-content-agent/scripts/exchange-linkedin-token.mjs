#!/usr/bin/env node
/**
 * Exchange LinkedIn authorization code for access + refresh tokens.
 * Usage (from repo root, with .env loaded):
 *   node scripts/exchange-linkedin-token.mjs "PASTE_AUTH_CODE_HERE"
 *
 * Requires: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 * Optional: LINKEDIN_REDIRECT_URI (must match authorization + LinkedIn app exactly)
 */
import 'dotenv/config';
import axios from 'axios';

const code = process.argv[2];
const redirectUri =
  process.env.LINKEDIN_REDIRECT_URI ?? 'http://localhost:3001/callback/linkedin';

if (!code) {
  console.error('Usage: node scripts/exchange-linkedin-token.mjs "<authorization_code>"');
  process.exit(1);
}

const clientId = process.env.LINKEDIN_CLIENT_ID;
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in .env');
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: redirectUri,
});

try {
  const { data } = await axios.post(
    'https://www.linkedin.com/oauth/v2/accessToken',
    body.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  console.log(JSON.stringify(data, null, 2));
  console.log('\nAdd to .env:\nLINKEDIN_ACCESS_TOKEN=' + (data.access_token ?? ''));
  if (data.refresh_token) {
    console.log('LINKEDIN_REFRESH_TOKEN=' + data.refresh_token);
  }
} catch (e) {
  const msg = e.response?.data ?? e.message;
  console.error('Token exchange failed:', msg);
  process.exit(1);
}
