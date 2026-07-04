// Error types + engine→product status/message mapping (REQ-023, REQ-097, REQ-097a).
// The web app renders these {message} strings verbatim. See 04-cross-cutting.md §g.

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorBody } from '../types/product-types.js';

// A product-level error with an explicit HTTP status and a browser-safe message.
// Thrown by services/routes (e.g. verify-after-write 409). REQ-097a.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// The typed error the engine adapter throws on a non-OK upstream response. Carries the
// raw upstream status + body so the mapping below (and the two-403 disambiguation) can
// inspect the engine's response shape (REQ-023). NEVER surfaced to web/ directly.
export class EngineError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`AnythingLLM responded ${status}`);
    this.name = 'EngineError';
  }
}

// Product messages, worded per 04-cross-cutting.md §g (rendered verbatim by web/).
const MSG = {
  keyRejection:
    'AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration).',
  precondition:
    'AnythingLLM refused this action: multi-user mode may be off or the operation is not permitted for this API key.',
  unauthorized: 'AnythingLLM authentication failed',
  notFound: 'The requested AnythingLLM resource was not found',
  rateLimited: 'AnythingLLM is rate limiting — retry shortly',
  unavailable: 'AnythingLLM is unavailable or returned an error',
} as const;

// Pull a lowercase text blob out of an arbitrary engine body for shape inspection.
function bodyText(body: unknown): string {
  if (typeof body === 'string') return body.toLowerCase();
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ['error', 'message']) {
      const v = rec[k];
      if (typeof v === 'string') parts.push(v);
    }
    return parts.join(' ').toLowerCase();
  }
  return '';
}

// Pull the engine's human-readable message out of the body WITH original casing preserved
// (unlike bodyText, which lowercases for shape-sniffing). Used to surface a field-level
// validation message verbatim to the operator (REQ-097a).
function bodyMessage(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() || null;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    for (const k of ['error', 'message']) {
      const v = rec[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

// Disambiguate the two 403 cases (REQ-023, MA-3): a structural key rejection (invalid/
// revoked developer key) vs an authorization/precondition refusal (multi-user off, or the
// action is not permitted for this key). Heuristic on the engine's response text.
function is403KeyRejection(body: unknown): boolean {
  const t = bodyText(body);
  return t.includes('api key') || t.includes('apikey') || t.includes('invalid api key');
}

// Map a thrown EngineError to the product {status, message} pair the web app renders.
export function mapEngineError(err: EngineError): { status: number; message: string } {
  const { status, body } = err;
  if (status === 400) {
    // Validation — surface the engine's field-level message verbatim (original casing).
    return { status: 400, message: bodyMessage(body) ?? 'Bad request' };
  }
  if (status === 401) return { status: 401, message: MSG.unauthorized };
  if (status === 403) {
    return {
      status: 403,
      message: is403KeyRejection(body) ? MSG.keyRejection : MSG.precondition,
    };
  }
  if (status === 404) return { status: 404, message: MSG.notFound };
  if (status === 429) return { status: 429, message: MSG.rateLimited };
  // 5xx / network / anything else → retryable unavailable.
  return { status: 502, message: MSG.unavailable };
}

// Fastify-compatible error handler: normalizes AppError, EngineError, Fastify validation
// errors, and unknowns into a product {message} body. Set in server/plugins.ts.
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.status).send({ message: error.message } satisfies ErrorBody);
    return;
  }
  if (error instanceof EngineError) {
    const mapped = mapEngineError(error);
    reply.status(mapped.status).send({ message: mapped.message } satisfies ErrorBody);
    return;
  }
  // Fastify schema-validation errors carry a 400 statusCode + validation array.
  if (error.validation || error.statusCode === 400) {
    reply.status(400).send({ message: error.message } satisfies ErrorBody);
    return;
  }
  // Log the unexpected server error but never leak internals to the browser.
  request.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply
    .status(status)
    .send({ message: status >= 500 ? 'Internal server error' : error.message } satisfies ErrorBody);
}
