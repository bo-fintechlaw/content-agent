# fintechlegal_website — newsletter track

Copy these files into `/Users/bojhowell/fintechlegal_website`:

| File | Destination |
|---|---|
| `sanity/schemas/newsletter.ts` | Sanity Studio schemas |
| `app/newsletter/[slug]/page.tsx` | Next.js App Router archive page |
| `middleware.ts` | Merge with existing middleware (UTM strip) |
| `components/NewsletterSubscribeForm.tsx` | Above-fold / footer CTA |

## SEO

- Canonical URLs strip `utm_*` and `?month=` query params
- JSON-LD: `Article` + `BreadcrumbList` on archive pages

## Subscribe

Wire form `POST` to content-agent `/api/newsletter/subscribe` or proxy via Next.js API route.
