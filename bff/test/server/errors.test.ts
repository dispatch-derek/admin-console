// server/errors.ts — mapEngineError + errorHandler (REQ-023, REQ-097/097a; design
// 04-cross-cutting.md §g). Pure module (no config/db imports); ordinary static imports OK.

import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest, FastifyError } from 'fastify';
import { AppError, EngineError, mapEngineError, errorHandler } from '../../src/server/errors.js';

describe('mapEngineError (REQ-023, REQ-097)', () => {
  it('maps 401 to the fixed unauthorized message', () => {
    expect(mapEngineError(new EngineError(401, { error: 'nope' }))).toEqual({
      status: 401,
      message: 'AnythingLLM authentication failed',
    });
  });

  it('maps 404 to the fixed not-found message', () => {
    expect(mapEngineError(new EngineError(404, {}))).toEqual({
      status: 404,
      message: 'The requested AnythingLLM resource was not found',
    });
  });

  it('maps 429 to the fixed rate-limited message', () => {
    expect(mapEngineError(new EngineError(429, 'slow down'))).toEqual({
      status: 429,
      message: 'AnythingLLM is rate limiting — retry shortly',
    });
  });

  it.each([500, 502, 503])('maps 5xx (%d) to 502 unavailable', (status) => {
    expect(mapEngineError(new EngineError(status, 'boom'))).toEqual({
      status: 502,
      message: 'AnythingLLM is unavailable or returned an error',
    });
  });

  it('maps a network-failure/status-0 error to 502 unavailable', () => {
    expect(mapEngineError(new EngineError(0, null))).toEqual({
      status: 502,
      message: 'AnythingLLM is unavailable or returned an error',
    });
  });

  it('maps an unrecognized status (e.g. 418) to 502 unavailable (fallback branch)', () => {
    expect(mapEngineError(new EngineError(418, { error: "I'm a teapot" }))).toEqual({
      status: 502,
      message: 'AnythingLLM is unavailable or returned an error',
    });
  });

  describe('400 — validation', () => {
    it('uses the raw string body verbatim (case preserved) when the body is a string', () => {
      expect(mapEngineError(new EngineError(400, 'Name is required'))).toEqual({
        status: 400,
        message: 'Name is required',
      });
    });

    it('falls back to "Bad request" when nothing derivable is in the body', () => {
      expect(mapEngineError(new EngineError(400, {}))).toEqual({
        status: 400,
        message: 'Bad request',
      });
      expect(mapEngineError(new EngineError(400, null))).toEqual({
        status: 400,
        message: 'Bad request',
      });
    });

    it('derives a field-level message from an object body, preserving its original casing', () => {
      // SUSPECTED BUG (server/errors.ts ~line 73): the 400 branch builds the message from
      // bodyText(body), which lowercases everything for the (unrelated) 403 shape-sniffing
      // heuristic. For an object-shaped body this means the field-level validation message
      // shown verbatim to the end user loses its original casing (e.g. "Name is required"
      // becomes "name is required"), unlike the string-body case just above which preserves
      // case exactly. This assertion encodes the INTENDED behavior (preserve case) per the
      // design doc's "field-level where derivable" — it currently fails against the
      // as-implemented lowercasing behavior.
      expect(mapEngineError(new EngineError(400, { message: 'Name is required' }))).toEqual({
        status: 400,
        message: 'Name is required',
      });
    });
  });

  describe('403 — the two-way disambiguation (REQ-023, MA-3)', () => {
    it('maps a structural key rejection ("api key" in the body) to the key-rejection message', () => {
      expect(mapEngineError(new EngineError(403, { error: 'Invalid API Key' }))).toEqual({
        status: 403,
        message:
          'AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration).',
      });
    });

    it('matches the "apikey" (no space) spelling too', () => {
      expect(mapEngineError(new EngineError(403, { message: 'apikey revoked' }))).toEqual({
        status: 403,
        message:
          'AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration).',
      });
    });

    it('matches a string body containing "invalid api key"', () => {
      expect(mapEngineError(new EngineError(403, 'Invalid API key supplied'))).toEqual({
        status: 403,
        message:
          'AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration).',
      });
    });

    it('maps everything else 403 to the authz/precondition message', () => {
      expect(
        mapEngineError(new EngineError(403, { error: 'Multi-user mode must be enabled' })),
      ).toEqual({
        status: 403,
        message:
          'AnythingLLM refused this action: multi-user mode may be off or the operation is not permitted for this API key.',
      });
    });

    it('falls back to the precondition message when the 403 body has no derivable text', () => {
      expect(mapEngineError(new EngineError(403, {}))).toEqual({
        status: 403,
        message:
          'AnythingLLM refused this action: multi-user mode may be off or the operation is not permitted for this API key.',
      });
    });
  });
});

// --- errorHandler: the Fastify-facing wiring around mapEngineError ---

function fakeReply(): FastifyReply {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

function fakeRequest(): FastifyRequest {
  const request = { log: { error: vi.fn() } };
  return request as unknown as FastifyRequest;
}

describe('errorHandler (REQ-097a)', () => {
  it('renders an AppError with its own status and message, untouched by mapEngineError', () => {
    const reply = fakeReply();
    const request = fakeRequest();

    errorHandler(new AppError(409, 'could not confirm the change was saved') as unknown as FastifyError, request, reply);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({ message: 'could not confirm the change was saved' });
    expect(request.log.error).not.toHaveBeenCalled();
  });

  it('renders an EngineError through mapEngineError', () => {
    const reply = fakeReply();
    const request = fakeRequest();

    errorHandler(
      new EngineError(403, { error: 'invalid api key' }) as unknown as FastifyError,
      request,
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      message: 'AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration).',
    });
  });

  it('renders a Fastify schema-validation error (validation array) as 400 with the raw message', () => {
    const reply = fakeReply();
    const request = fakeRequest();
    const err = Object.assign(new Error('body must have required property x'), {
      validation: [{ keyword: 'required' }],
      statusCode: 400,
    }) as unknown as FastifyError;

    errorHandler(err, request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ message: 'body must have required property x' });
  });

  it('renders a plain statusCode-400 error (no validation array) as 400 with its message', () => {
    const reply = fakeReply();
    const request = fakeRequest();
    const err = Object.assign(new Error('bad input'), { statusCode: 400 }) as unknown as FastifyError;

    errorHandler(err, request, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ message: 'bad input' });
  });

  it('passes through a known non-500 statusCode with its own message (e.g. 403 from elsewhere)', () => {
    const reply = fakeReply();
    const request = fakeRequest();
    const err = Object.assign(new Error('forbidden by a plugin'), { statusCode: 403 }) as unknown as FastifyError;

    errorHandler(err, request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ message: 'forbidden by a plugin' });
  });

  it('logs and masks an unknown error with no usable statusCode as a generic 500', () => {
    const reply = fakeReply();
    const request = fakeRequest();
    const err = new Error('TypeError: cannot read property of undefined (internal detail)') as FastifyError;

    errorHandler(err, request, reply);

    expect(request.log.error).toHaveBeenCalledWith(err);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Internal server error' });
  });

  it('masks the message even for an explicit statusCode >= 500 (never leak internals)', () => {
    const reply = fakeReply();
    const request = fakeRequest();
    const err = Object.assign(new Error('stack trace leaked here'), {
      statusCode: 503,
    }) as unknown as FastifyError;

    errorHandler(err, request, reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Internal server error' });
  });
});
