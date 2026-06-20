import { createClient } from '@sanity/client';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NewsletterIssueView, type NewsletterIssue } from '../../../components/NewsletterIssueView';

const SITE = 'https://fintechlaw.ai';

type Props = { params: Promise<{ slug: string }> };

function sanityClient() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production';
  if (!projectId) return null;
  return createClient({
    projectId,
    dataset,
    apiVersion: '2025-02-19',
    useCdn: true,
  });
}

async function fetchIssue(slug: string): Promise<NewsletterIssue | null> {
  const client = sanityClient();
  if (!client) return null;
  return client.fetch(
    `*[_type == "newsletter" && slug.current == $slug][0]{
      title,
      "issue_date": issueDate,
      intro,
      toc,
      panels,
      "author": { "name": authorName, "title": authorTitle },
      "footer": {
        "disclaimer": footerDisclaimer,
        "physical_address": coalesce(physicalAddress, "FinTech Law LLC"),
        "subscribe_url": subscribeUrl
      }
    }`,
    { slug }
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const issue = await fetchIssue(slug);
  const canonical = `${SITE}/newsletters/${slug}`;
  return {
    title: issue?.title ? `${issue.title} | FinTech Law Newsletter` : `Newsletter — ${slug}`,
    description: issue?.intro?.slice(0, 160),
    alternates: { canonical },
    openGraph: { url: canonical, title: issue?.title, description: issue?.intro?.slice(0, 160) },
  };
}

export default async function NewsletterArchivePage({ params }: Props) {
  const { slug } = await params;
  const issue = await fetchIssue(slug);
  if (!issue) notFound();

  return (
    <main className="py-12">
      <NewsletterIssueView issue={issue} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: issue.title,
            datePublished: issue.issue_date,
            url: `${SITE}/newsletters/${slug}`,
            author: { '@type': 'Person', name: issue.author.name },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
              { '@type': 'ListItem', position: 2, name: 'Newsletter', item: `${SITE}/newsletter` },
              { '@type': 'ListItem', position: 3, name: issue.title, item: `${SITE}/newsletters/${slug}` },
            ],
          }),
        }}
      />
    </main>
  );
}
