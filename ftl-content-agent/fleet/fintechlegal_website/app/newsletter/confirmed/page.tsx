import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Subscription Confirmed | FinTech Law Newsletter',
  description: 'Your FinTech Law newsletter subscription is confirmed.',
};

export default function NewsletterConfirmedPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="text-sm uppercase tracking-widest text-[#D41367]">FinTech Law Newsletter</p>
      <h1 className="mt-3 font-['Playfair_Display',Georgia,serif] text-3xl text-[#0A0A0A]">
        You are subscribed
      </h1>
      <p className="mt-4 text-lg text-[#525866]">
        Thanks for confirming. The next issue for your selected segment will arrive in your inbox
        on the regular schedule.
      </p>
      <Link href="/newsletter" className="mt-8 inline-block text-[#D41367] hover:underline">
        Browse the archive →
      </Link>
    </main>
  );
}
