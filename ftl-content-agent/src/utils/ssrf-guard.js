/** Max bytes read from an external HTTP response before parsing. */
export const MAX_FETCH_RESPONSE_BYTES = 512 * 1024;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.google',
]);

/**
 * @param {string} host
 * @returns {number[] | null}
 */
function parseIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map((x) => Number.parseInt(x, 10));
  if (octets.some((o) => o > 255 || o < 0)) return null;
  return octets;
}

/**
 * @param {number[]} octets
 */
function isPrivateIpv4(octets) {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * @param {string} host
 */
function isPrivateIpv6(host) {
  const h = host.toLowerCase();
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('fe80:')) return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

/**
 * Validate a user-supplied URL before server-side fetch (SSRF guard).
 * @param {unknown} urlString
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateExternalUrl(urlString) {
  if (urlString == null || typeof urlString !== 'string') {
    return { ok: false, error: 'missing_url' };
  }
  const trimmed = urlString.trim();
  if (!trimmed) {
    return { ok: false, error: 'missing_url' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'credentials_in_url' };
  }

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    return { ok: false, error: 'blocked_host' };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    return { ok: false, error: 'private_ip' };
  }

  if (hostname.includes(':') && isPrivateIpv6(hostname)) {
    return { ok: false, error: 'private_ip' };
  }

  return { ok: true, url: parsed.href };
}

/**
 * Read a fetch Response body capped at maxBytes.
 * @param {Response} response
 * @param {number} [maxBytes]
 * @returns {Promise<Uint8Array>}
 */
export async function readResponseBodyCapped(response, maxBytes = MAX_FETCH_RESPONSE_BYTES) {
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength <= maxBytes) return raw;
  return raw.slice(0, maxBytes);
}
