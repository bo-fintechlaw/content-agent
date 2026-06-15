import Link from 'next/link';
import { createClient } from '@sanity/client';
import type { Metadata } from 'next';

const SITE = 'https://fintechlaw.ai';

export const metadata: Metadata = {
  title: 'Newsletter Archive | FinTech Law',
  description: 'Past issues of The Financial Edge and The Startup Solution from FinTech Law.',
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
        <p className="text-sm uppercase tracking-widest text-[#6f739d]">FinTech Law Newsletter</p>
        <h1 className="mt-2 font-serif text-4xl text-[#191919]">Archive</h1>
        <p className="mt-3 text-lg text-[#6f739d]">
          The Financial Edge and The Startup Solution — regulatory and governance guidance for fintech
          teams.
        </p>
      </header>

      {issues.length === 0 ? (
        <p className="text-[#6f739d]">No published issues yet. Check back after the next send.</p>
      ) : (
        <ul className="divide-y divide-[#cfd0de] border-y border-[#cfd0de]">
          {issues.map((issue) => (
            <li key={issue.slug} className="py-6">
              <Link href={`/newsletters/${issue.slug}`} className="group no-underline">
                <p className="text-xs uppercase tracking-wide text-[#4d539c]">{issue.issue_date}</p>
                <h2 className="mt-1 font-serif text-2xl text-[#191919] group-hover:text-[#4d539c]">
                  {issue.title}
                </h2>
                <p className="mt-2 text-[#6f739d]">{issue.intro.slice(0, 180)}…</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
