// White-box unit tests for the F-005 feature-toggle client functions (src/api/client.ts,
// REQ-F005-028). Complements client.test.ts's generic smoke coverage (error mapping, 204 handling)
// with the F-005-specific contract this file doesn't touch: the opaque featureKey is
// percent-encoded EXACTLY ONCE into the path segment before every PUT/DELETE, the PUT body shape is
// exactly `{ enabled }`, and GET carries no body/query. Mocks only the `fetch` global, mirroring
// client.test.ts's own convention.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function lastFetchCall(): [string, RequestInit | undefined] {
  const mock = fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit | undefined];
  return [url, init];
}

describe('api client — feature toggles (REQ-F005-028 opaque featureKey encoding)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listFeatureToggles() GETs /api/feature-toggles with no body', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ customerLabel: 'Acme', features: [], counts: { enabled: 0, disabled: 0, total: 0 } }),
    );
    await api.listFeatureToggles();
    const [url, init] = lastFetchCall();
    expect(url).toContain('/api/feature-toggles');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('setFeatureToggle percent-encodes a plain key and sends PUT { enabled }', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ featureKey: 'k', enabled: true }));
    await api.setFeatureToggle('billing.invoices', true);
    const [url, init] = lastFetchCall();
    expect(url).toContain('/api/feature-toggles/billing.invoices');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toEqual({ enabled: true });
  });

  it('setFeatureToggle percent-encodes a key containing "/" and whitespace into a single path segment', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ featureKey: 'a/b c', enabled: true }));
    await api.setFeatureToggle('a/b c', true);
    const [url] = lastFetchCall();
    expect(url).toContain('/api/feature-toggles/a%2Fb%20c');
    expect(url).not.toContain('/api/feature-toggles/a/b c'); // never sent raw/unencoded
  });

  it('setFeatureToggle sends enabled:false exactly (falsy-but-valid, not omitted)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ featureKey: 'k', enabled: false }));
    await api.setFeatureToggle('k', false);
    const [, init] = lastFetchCall();
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ enabled: false });
    expect('enabled' in body).toBe(true);
  });

  it('clearFeatureToggleOverride percent-encodes the key and issues DELETE to the /override sub-path', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ featureKey: 'a/b c', enabled: false, hasOverride: false }),
    );
    await api.clearFeatureToggleOverride('a/b c');
    const [url, init] = lastFetchCall();
    expect(url).toContain('/api/feature-toggles/a%2Fb%20c/override');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('a featureKey containing characters that are themselves percent-sign-shaped ("%2F" literal) is double-escaped, not conflated with an actual slash', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ featureKey: '%2F', enabled: true }));
    await api.setFeatureToggle('%2F', true);
    const [url] = lastFetchCall();
    // encodeURIComponent('%2F') === '%252F' — the literal percent sign is itself escaped.
    expect(url).toContain('/api/feature-toggles/%252F');
  });

  it('propagates a non-OK response as an ApiError with the verbatim BFF message (REQ-097a)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'unknown feature' }, 404),
    );
    await expect(api.setFeatureToggle('never-declared', true)).rejects.toMatchObject({
      name: 'ApiError',
      message: 'unknown feature',
      status: 404,
    });
  });
});
