import type { Metadata } from 'next';

type Props = { params: Promise<{ slug: string }> };

const SITE = 'https://fintechlaw.ai';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `${SITE}/newsletter/${slug}`;
  return {
    title: `Newsletter — ${slug}`,
    alternates: { canonical },
    openGraph: { url: canonical },
  };
}

export default async function NewsletterArchivePage({ params }: Props) {
  const { slug } = await params;
  // Fetch from Sanity GROQ in production:
  // *[_type == "newsletter" && slug.current == $slug][0]
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article>
        <header className="mb-8">
          <p className="text-sm uppercase tracking-widest text-slate-500">FinTech Law Newsletter</p>
          <h1 className="mt-2 text-4xl font-serif">{slug}</h1>
        </header>
        <p className="text-lg text-slate-700">
          Indexable newsletter archive. Wire Sanity fetch + Portable Text renderer here.
        </p>
      </article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: slug,
            url: `${SITE}/newsletter/${slug}`,
            author: { '@type': 'Person', name: 'Bo Howell' },
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
              { '@type': 'ListItem', position: 3, name: slug, item: `${SITE}/newsletter/${slug}` },
            ],
          }),
        }}
      />
    </main>
  );
}
