import { RANKER_SYSTEM_PROMPT, buildRankerUserPrompt } from '../../prompts/ranker-system.js';
import {
  DRAFTER_SYSTEM_PROMPT,
  buildDrafterUserPrompt,
} from '../../prompts/drafter-system.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from '../../prompts/judge-system.js';

/** @type {import('./index.js').BrandConfig} */
export const fintechlawBrand = {
  id: 'fintechlaw',
  displayName: 'FinTech Law',
  publishMode: 'live',
  siteUrl: 'https://fintechlaw.ai',
  slackLabel: 'FinTech Law',
  categories: [
    'regulatory',
    'financial_services',
    'ai_legal_tech',
    'legal_engineering',
    'crypto',
    'fintech',
    'startup',
  ],
  blogCategoryMap: {},
  author: {
    name: 'Bo Howell',
    title: 'Managing Director & CEO',
  },
  prompts: {
    rankerSystem: RANKER_SYSTEM_PROMPT,
    buildRankerUser: buildRankerUserPrompt,
    drafterSystem: DRAFTER_SYSTEM_PROMPT,
    buildDrafterUser: buildDrafterUserPrompt,
    judgeSystem: JUDGE_SYSTEM_PROMPT,
    buildJudgeUser: buildJudgeUserPrompt,
  },
};
