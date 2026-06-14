import dotenv from 'dotenv';
import { runNewsletterIssue } from './run-newsletter-issue.js';

dotenv.config({ override: true });

const segment = process.argv.includes('--segment')
  ? process.argv[process.argv.indexOf('--segment') + 1]
  : 'financial_services';

runNewsletterIssue({ segment })
  .then((out) => {
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
