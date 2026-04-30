#!/usr/bin/env node
// Manually trigger the ranker against production Supabase.
// Usage: node scripts/run-ranker.mjs

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { validateEnv } from '../src/config/env.js';
import { createSupabaseClient } from '../src/db/supabase.js';
import { runTopicRanking } from '../src/pipeline/ranker.js';

const config = validateEnv();
const supabase = createSupabaseClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

console.log('Running ranker with model:', config.ANTHROPIC_MODEL);
const result = await runTopicRanking(supabase, config);
console.log(JSON.stringify(result, null, 2));
