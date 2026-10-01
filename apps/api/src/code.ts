import { randomBytes } from 'node:crypto';

/** 6 random bytes encode to exactly 8 URL-safe base64 characters. */
export function generateCode(): string {
  return randomBytes(6).toString('base64url');
}
