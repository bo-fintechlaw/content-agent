import { describe, expect, it } from '@jest/globals';

const { validateExternalUrl, MAX_FETCH_RESPONSE_BYTES } = await import('../../utils/ssrf-guard.js');

describe('validateExternalUrl', () => {
  it('accepts public https URLs', () => {
    expect(validateExternalUrl('https://www.sec.gov/news')).toEqual({
      ok: true,
      url: 'https://www.sec.gov/news',
    });
  });

  it('accepts public http URLs', () => {
    const result = validateExternalUrl('http://example.com/path');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('http://example.com/path');
  });

  it('rejects missing or empty URLs', () => {
    expect(validateExternalUrl('')).toEqual({ ok: false, error: 'missing_url' });
    expect(validateExternalUrl(null)).toEqual({ ok: false, error: 'missing_url' });
  });

  it('rejects invalid URLs', () => {
    expect(validateExternalUrl('not-a-url')).toEqual({ ok: false, error: 'invalid_url' });
  });

  it('rejects non-http(s) protocols', () => {
    expect(validateExternalUrl('file:///etc/passwd')).toEqual({
      ok: false,
      error: 'unsupported_protocol',
    });
    expect(validateExternalUrl('ftp://example.com/x')).toEqual({
      ok: false,
      error: 'unsupported_protocol',
    });
  });

  it('rejects credentials embedded in the URL', () => {
    expect(validateExternalUrl('https://user:pass@example.com/')).toEqual({
      ok: false,
      error: 'credentials_in_url',
    });
  });

  it('rejects localhost and metadata hosts', () => {
    expect(validateExternalUrl('http://localhost/admin')).toEqual({
      ok: false,
      error: 'blocked_host',
    });
    expect(validateExternalUrl('http://metadata.google.internal/')).toEqual({
      ok: false,
      error: 'blocked_host',
    });
  });

  it('rejects private IPv4 ranges', () => {
    expect(validateExternalUrl('http://127.0.0.1/')).toEqual({ ok: false, error: 'private_ip' });
    expect(validateExternalUrl('http://10.0.0.1/')).toEqual({ ok: false, error: 'private_ip' });
    expect(validateExternalUrl('http://172.16.0.1/')).toEqual({ ok: false, error: 'private_ip' });
    expect(validateExternalUrl('http://192.168.1.1/')).toEqual({ ok: false, error: 'private_ip' });
    expect(validateExternalUrl('http://169.254.169.254/')).toEqual({
      ok: false,
      error: 'private_ip',
    });
  });

  it('rejects private IPv6 addresses', () => {
    expect(validateExternalUrl('http://[::1]/')).toEqual({ ok: false, error: 'private_ip' });
    expect(validateExternalUrl('http://[fe80::1]/')).toEqual({ ok: false, error: 'private_ip' });
  });

  it('exports a 512KB response cap constant', () => {
    expect(MAX_FETCH_RESPONSE_BYTES).toBe(512 * 1024);
  });
});
