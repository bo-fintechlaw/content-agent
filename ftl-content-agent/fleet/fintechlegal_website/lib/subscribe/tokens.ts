import crypto from 'crypto';
import { TOKEN_EXPIRY_HOURS } from './constants.js';

export type TokenPurpose = 'confirm' | 'unsubscribe';

export type VerifiedToken = {
  email: string;
  subscriberId: string;
  timestamp: number;
};

export function generateToken(
  purpose: TokenPurpose,
  email: string,
  subscriberId: string,
  tokenSecret: string
): string {
  const timestamp = Date.now();
  const data = `${purpose}:${email}:${subscriberId}:${timestamp}`;
  const signature = crypto.createHmac('sha256', tokenSecret).update(data).digest('hex');
  return Buffer.from(`${data}:${signature}`).toString('base64url');
}

export function verifyToken(
  purpose: TokenPurpose,
  token: string,
  tokenSecret: string
): VerifiedToken | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 5) return null;

    const [tokenPurpose, email, subscriberId, timestamp, signature] = parts;
    if (tokenPurpose !== purpose) return null;

    const data = `${tokenPurpose}:${email}:${subscriberId}:${timestamp}`;
    const expectedSignature = crypto.createHmac('sha256', tokenSecret).update(data).digest('hex');
    if (signature !== expectedSignature) return null;

    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const expiryMs = TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
    if (tokenAge > expiryMs) return null;

    return { email, subscriberId, timestamp: parseInt(timestamp, 10) };
  } catch {
    return null;
  }
}
