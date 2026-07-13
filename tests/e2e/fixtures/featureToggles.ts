import type { Page, Route } from '@playwright/test';

// Stateful /api/feature-toggles* mock (F-005, spec §7). Unlike the rest of `mockApi.ts` (static
// canned responses), this fixture keeps a real in-memory catalog + override map and answers GET/
// PUT/DELETE against it, so the journeys in `feature-toggles.spec.ts` exercise the REAL browser
// fetch -> percent-encoded path -> route-matched-by-path contract (REQ-F005-028) rather than a
// component-level mocked client function (which is what the existing jsdom/RTL
// `FeatureTogglesPage.test.tsx` already covers).
//
// Must be installed AFTER `installApiMocks(page)`: Playwright resolves the most-recently
// registered matching `page.route` handler first, so this fixture's more specific
// `**/api/feature-toggles**` pattern takes precedence over `mockApi.ts`'s generic `**/api/**`
// catch-all for these paths, while still falling back to it for anything this fixture doesn't
// itself recognize.

export interface E2EFeatureCatalogEntry {
  featureKey: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  defaultEnabled: boolean;
}

interface OverrideRow {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

export const CUSTOMER_LABEL = 'Acme E2E Corp';

// REQ-F005-060: the exact fixed neutral literal the BFF falls back to when `CUSTOMER_LABEL` is
// unset. Never an engine-derived value (`ANYTHINGLLM_BASE_URL`, engine origin/host/port).
export const CUSTOMER_LABEL_FALLBACK = 'this install';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export interface FeatureToggleMockHandle {
  /** Current override count, useful for assertions that don't want to re-derive it from the DOM. */
  overrideCount(): number;
}

export interface InitialOverride {
  featureKey: string;
  enabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export async function installFeatureToggleMocks(
  page: Page,
  catalog: E2EFeatureCatalogEntry[],
  opts: { actor?: string; initialOverrides?: InitialOverride[]; customerLabel?: string } = {},
): Promise<FeatureToggleMockHandle> {
  const actor = opts.actor ?? 'e2e-operator';
  const customerLabel = opts.customerLabel ?? CUSTOMER_LABEL;
  const overrides = new Map<string, OverrideRow>();
  for (const o of opts.initialOverrides ?? []) {
    overrides.set(o.featureKey, {
      enabled: o.enabled,
      updatedAt: o.updatedAt ?? '2026-07-01T00:00:00.000Z',
      updatedBy: o.updatedBy ?? actor,
    });
  }

  function effective(entry: E2EFeatureCatalogEntry): boolean {
    const o = overrides.get(entry.featureKey);
    return o ? o.enabled : entry.defaultEnabled;
  }

  function toFeatureToggle(entry: E2EFeatureCatalogEntry) {
    const o = overrides.get(entry.featureKey);
    return {
      featureKey: entry.featureKey,
      displayName: entry.displayName,
      description: entry.description ?? null,
      category: entry.category ?? null,
      defaultEnabled: entry.defaultEnabled,
      enabled: effective(entry),
      hasOverride: !!o,
      updatedAt: o?.updatedAt ?? null,
      updatedBy: o?.updatedBy ?? null,
    };
  }

  function listView() {
    const features = catalog.map(toFeatureToggle);
    const enabled = features.filter((f) => f.enabled).length;
    return {
      customerLabel,
      features,
      counts: { enabled, disabled: features.length - enabled, total: features.length },
    };
  }

  await page.route('**/api/feature-toggles**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const parts = url.pathname.split('/').filter(Boolean); // ['api','feature-toggles', <key>?, 'override'?]

    if (method === 'GET' && parts.length === 2) {
      return json(route, listView());
    }

    if (parts.length >= 3) {
      const rawKey = parts[2];
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawKey);
      } catch {
        return json(route, { message: 'malformed feature key' }, 400);
      }
      const entry = catalog.find((c) => c.featureKey === decoded);

      if (method === 'PUT' && parts.length === 3) {
        if (!entry) return json(route, { message: 'unknown feature' }, 404);
        let body: unknown;
        try {
          body = req.postDataJSON();
        } catch {
          body = undefined;
        }
        const enabled = (body as { enabled?: unknown } | undefined)?.enabled;
        if (typeof enabled !== 'boolean') {
          return json(route, { message: 'enabled must be true or false' }, 400);
        }
        overrides.set(decoded, { enabled, updatedAt: new Date().toISOString(), updatedBy: actor });
        return json(route, toFeatureToggle(entry));
      }

      if (method === 'DELETE' && parts.length === 4 && parts[3] === 'override') {
        if (!entry) return json(route, { message: 'unknown feature' }, 404);
        overrides.delete(decoded);
        return json(route, toFeatureToggle(entry));
      }
    }

    return route.fallback();
  });

  return { overrideCount: () => overrides.size };
}
