import { ApiError } from './errors.js';

export const MAX_BODY_BYTES = 100 * 1024;

const MAX_VIEWS = { min: 1, max: 100, fallback: 1 };
const EXPIRES_IN = { min: 60, max: 604_800, fallback: 86_400 };

export interface CreateInput {
  content: string;
  maxViews: number;
  expiresIn: number;
}

export function parseCreateBody(body: unknown): CreateInput {
  if (body === undefined) {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const { content } = fields;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ApiError(400, 'invalid_content', 'content must be a non-empty string.');
  }
  // Size is counted in UTF-8 bytes, not characters.
  if (Buffer.byteLength(content, 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError(400, 'invalid_content', 'content must be at most 100 KB.');
  }

  return {
    content,
    maxViews: intField(fields.max_views, 'max_views', MAX_VIEWS),
    expiresIn: intField(fields.expires_in, 'expires_in', EXPIRES_IN),
  };
}

function intField(
  value: unknown,
  name: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(400, 'invalid_field', `${name} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}
