import Link from 'next/link';
import { createClient } from '@sanity/client';
import type { Metadata } from 'next';
import { SubscribeForm } from '../../components/SubscribeForm';

const SITE = 'https://fintechlaw.ai';

export const metadata: Metadata = {
  title: 'Newsletter | FinTech Law',
  description:
    'The Financial Edge and The Startup Solution — biweekly regulatory and legal-engineering guidance from FinTech Law.',
  alternates: { canonical: `${SITE}/newsletter` },
};

function sanityClient() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production';
  if (!projectId) return null;
  return createClient({ projectId, dataset, apiVersion: '2025-02-19', useCdn: true });
}

type IssueRow = { title: string; slug: string; issue_date: string; intro: string };

async function fetchIssues(): Promise<IssueRow[]> {
  const client = sanityClient();
  if (!client) return [];
  return client.fetch(
    `*[_type == "newsletter"] | order(issueDate desc) {
      title,
      "slug": slug.current,
      "issue_date": issueDate,
      intro
    }[0...50]`
  );
}

export default async function NewsletterIndexPage() {
  const issues = await fetchIssues();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="text-sm uppercase tracking-widest text-[#525866]">FinTech Law Newsletter</p>
        <h1 className="mt-2 font-['Playfair_Display',Georgia,serif] text-4xl text-[#0A0A0A]">
          Archive
        </h1>
        <p className="mt-3 text-lg text-[#525866]">
          The Financial Edge (financial services) and The Startup Solution (tech &amp; AI legal)
          — biweekly guidance for operators and counsel.
        </p>
      </header>

      <div className="mb-12">
        <SubscribeForm />
      </div>

      {issues.length === 0 ? (
        <p className="text-[#525866]">No published issues yet. Check back after the next send.</p>
      ) : (
        <ul className="divide-y divide-[#d8dae3] border-y border-[#d8dae3]">
          {issues.map((issue) => (
            <li key={issue.slug} className="py-6">
              <Link href={`/newsletters/${issue.slug}`} className="group no-underline">
                <p className="text-xs uppercase tracking-wide text-[#D41367]">{issue.issue_date}</p>
                <h2 className="mt-1 font-['Playfair_Display',Georgia,serif] text-2xl text-[#0A0A0A] group-hover:text-[#D41367]">
                  {issue.title}
                </h2>
                <p className="mt-2 text-[#525866]">{issue.intro.slice(0, 180)}…</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
