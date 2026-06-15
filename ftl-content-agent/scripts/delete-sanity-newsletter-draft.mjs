import dotenv from 'dotenv';
import { validateEnv } from '../src/config/env.js';
import { createSanityClient } from '../src/integrations/sanity.js';

dotenv.config({ override: true });

const config = validateEnv();
const client = createSanityClient(config);
const draftId = process.argv[2] || 'drafts.newsletter-financial-edge-2026-06';

try {
  await client.delete(draftId);
  console.log('Deleted', draftId);
} catch (err) {
  if (String(err?.message || err).includes('not found')) {
    console.log('Already absent:', draftId);
  } else {
    throw err;
  }
}
