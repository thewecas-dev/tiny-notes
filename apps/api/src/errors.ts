import type { ErrorRequestHandler, RequestHandler } from 'express';

export type ErrorCode =
  | 'invalid_json'
  | 'invalid_content'
  | 'invalid_field'
  | 'payload_too_large'
  | 'not_found'
  | 'internal_error';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// One message for unknown, expired and used-up notes so callers cannot tell them apart.
export const notFound = () => new ApiError(404, 'not_found', 'Note not found.');

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound());

export function errorHandler(log: (line: string) => void): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const apiError = toApiError(err);
    if (apiError.status === 500) {
      // Name and message only: never the request body.
      log(`error ${err?.name ?? 'Error'}: ${err?.message ?? 'unknown'}`);
    }
    res.status(apiError.status).json({ error: apiError.code, message: apiError.message });
  };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  // Errors raised by express.json() carry a `type` and an HTTP `status`.
  const { type, status } = (err ?? {}) as { type?: string; status?: number };
  if (type === 'entity.too.large') {
    return new ApiError(413, 'payload_too_large', 'Request body must be at most 100 KB.');
  }
  if (type === 'entity.parse.failed' || (status !== undefined && status >= 400 && status < 500)) {
    return new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  return new ApiError(500, 'internal_error', 'Unexpected server error.');
}
