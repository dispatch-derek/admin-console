import type { ErrorBody } from './types';

// Carries the BFF's { message } so the UI can render it VERBATIM (REQ-097a). Never rewrites or
// prettifies the upstream message.
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Build an ApiError from a non-OK Response, preferring the parsed { message } body. Falls back to
// the status text only when the body is missing or unparseable.
export async function apiErrorFrom(res: Response): Promise<ApiError> {
  let message = res.statusText || `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as Partial<ErrorBody>;
    if (body && typeof body.message === 'string' && body.message.length > 0) {
      message = body.message;
    }
  } catch {
    // Non-JSON error body: keep the status-text fallback.
  }
  return new ApiError(message, res.status);
}
