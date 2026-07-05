import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './client';
import { ApiError } from './errors';

// Smoke coverage for REQ-097a: a non-OK response throws an ApiError carrying the BFF { message }
// verbatim; a 204 resolves to void.
describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    api.setUnauthorizedHandler(null);
  });

  it('throws ApiError with the verbatim BFF message on non-OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }),
    );
    await expect(api.me()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Invalid credentials',
      status: 401,
    });
  });

  it('fires the unauthorized handler on a 401', async () => {
    const handler = vi.fn();
    api.setUnauthorizedHandler(handler);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 401 }),
    );
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('resolves 204 responses to undefined', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
