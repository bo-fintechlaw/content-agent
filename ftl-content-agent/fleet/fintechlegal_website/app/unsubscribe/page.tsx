import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Unsubscribed | FinTech Law Newsletter',
  description: 'You have been unsubscribed from FinTech Law newsletters.',
};

type Props = { searchParams: Promise<{ done?: string }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const params = await searchParams;
  const done = params.done === '1';

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="text-sm uppercase tracking-widest text-[#525866]">FinTech Law Newsletter</p>
      <h1 className="mt-3 font-['Playfair_Display',Georgia,serif] text-3xl text-[#0A0A0A]">
        {done ? 'You have been unsubscribed' : 'Unsubscribe'}
      </h1>
      <p className="mt-4 text-lg text-[#525866]">
        {done
          ? 'You will no longer receive newsletter emails from FinTech Law for the list you opted out of.'
          : 'Use the unsubscribe link in any newsletter email to remove yourself from our list.'}
      </p>
      <Link href="/newsletter" className="mt-8 inline-block text-[#D41367] hover:underline">
        Return to newsletter →
      </Link>
    </main>
  );
}
