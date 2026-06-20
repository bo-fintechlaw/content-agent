'use client';

const SEGMENTS = [
  { id: 'financial_services', label: 'Financial Services' },
  { id: 'tech_ai_legal', label: 'Tech & AI / Legal Engineering' },
  { id: 'both', label: 'Both' },
];

export function NewsletterSubscribeForm() {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const segment = String(fd.get('segment') ?? 'both');
    const segments =
      segment === 'both' ? ['financial_services', 'tech_ai_legal'] : [segment];

    await fetch('/.netlify/functions/newsletter-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, segments }),
    });
    alert('Check your inbox to confirm your subscription.');
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Subscribe to the newsletter</h2>
      <p className="mt-2 text-sm text-slate-600">Choose your segment. Double opt-in required.</p>
      <input
        name="email"
        type="email"
        required
        placeholder="you@firm.com"
        className="mt-4 w-full rounded border px-3 py-2"
      />
      <select name="segment" className="mt-3 w-full rounded border px-3 py-2">
        {SEGMENTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button type="submit" className="mt-4 rounded bg-slate-900 px-4 py-2 text-white">
        Subscribe
      </button>
    </form>
  );
}
