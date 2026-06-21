import {
  RANKER_SYSTEM_PROMPT_RIKKA,
  buildRankerUserPromptRikka,
} from '../../prompts/ranker-system-rikka.js';
import {
  DRAFTER_SYSTEM_PROMPT_RIKKA,
  buildDrafterUserPromptRikka,
} from '../../prompts/drafter-system-rikka.js';
import {
  JUDGE_SYSTEM_PROMPT_RIKKA,
  buildJudgeUserPromptRikka,
} from '../../prompts/judge-system-rikka.js';

/** @type {import('./index.js').BrandConfig} */
export const rikkaBrand = {
  id: 'rikka',
  displayName: 'Rikka Law',
  publishMode: 'ftl_test',
  siteUrl: 'https://fintechlaw.ai',
  slackLabel: 'Rikka / Charlyn Ho',
  categories: ['privacy', 'data_protection', 'ai_governance'],
  blogCategoryMap: {
    privacy: 'privacy-data-protection',
    data_protection: 'privacy-data-protection',
    ai_governance: 'ai-governance',
  },
  author: {
    name: 'Charlyn Ho',
    title: 'CEO & Founder, Rikka Law',
  },
  prompts: {
    rankerSystem: RANKER_SYSTEM_PROMPT_RIKKA,
    buildRankerUser: buildRankerUserPromptRikka,
    drafterSystem: DRAFTER_SYSTEM_PROMPT_RIKKA,
    buildDrafterUser: buildDrafterUserPromptRikka,
    judgeSystem: JUDGE_SYSTEM_PROMPT_RIKKA,
    buildJudgeUser: buildJudgeUserPromptRikka,
  },
};
