'use client';

const SEGMENTS = [
  { id: 'financial_services', label: 'Financial Services — The Financial Edge' },
  { id: 'tech_ai_legal', label: 'Tech & AI / Legal Engineering — The Startup Solution' },
  { id: 'both', label: 'Both newsletters' },
];

/** Same-origin Netlify function by default; override for local content-agent dev. */
const SUBSCRIBE_API_URL =
  process.env.NEXT_PUBLIC_SUBSCRIBE_API_URL ?? '/api/subscribe';

type SubscribeFormProps = {
  source?: string;
  heading?: string;
  compact?: boolean;
};

export function SubscribeForm({
  source = 'newsletter-page',
  heading = 'Subscribe to the newsletter',
  compact = false,
}: SubscribeFormProps) {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const segment = String(fd.get('segment') ?? 'both');
    const segments =
      segment === 'both' ? ['financial_services', 'tech_ai_legal'] : [segment];

    const res = await fetch(SUBSCRIBE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, segments, source }),
    });
    if (!res.ok) {
      alert('Subscription request failed. Please try again.');
      return;
    }
    alert('Check your inbox to confirm your subscription.');
  }

  return (
    <form
      onSubmit={onSubmit}
      className={
        compact
          ? 'rounded-lg border border-[#d8dae3] bg-white p-4 shadow-sm'
          : 'rounded-lg border border-[#d8dae3] bg-white p-6 shadow-sm'
      }
    >
      <h2
        className={
          compact
            ? "font-['Playfair_Display',Georgia,serif] text-lg text-[#0A0A0A]"
            : "font-['Playfair_Display',Georgia,serif] text-xl text-[#0A0A0A]"
        }
      >
        {heading}
      </h2>
      <p className="mt-2 text-sm text-[#525866]">
        Choose your segment. Double opt-in required.
      </p>
      <input
        name="email"
        type="email"
        required
        placeholder="you@firm.com"
        className="mt-4 w-full rounded border border-[#d8dae3] px-3 py-2"
      />
      <select name="segment" className="mt-3 w-full rounded border border-[#d8dae3] px-3 py-2">
        {SEGMENTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="mt-4 rounded bg-[#0A0A0A] px-4 py-2 font-semibold text-white hover:bg-[#D41367]"
      >
        Subscribe
      </button>
    </form>
  );
}

/** @deprecated Use SubscribeForm */
export const NewsletterSubscribeForm = SubscribeForm;
