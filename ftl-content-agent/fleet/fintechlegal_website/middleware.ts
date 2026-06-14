import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const STRIP_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'month'];

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  let changed = false;

  for (const key of [...url.searchParams.keys()]) {
    if (STRIP_PARAMS.includes(key) || key.startsWith('utm_')) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (changed) {
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/newsletter/:path*', '/blog/:path*'],
};
