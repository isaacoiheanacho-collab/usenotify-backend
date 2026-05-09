import { randomBytes } from 'crypto';

export function generateReferralCode(): string {
  // Generate 8-character alphanumeric code
  return randomBytes(4).toString('hex').toUpperCase();
}