import type { Page, Route } from '@playwright/test';

// Shared /api/* mock layer. The app talks ONLY to relative /api/* paths (Vite proxies them to the
// BFF in dev; the production build talks to whatever origin served it). We never stand up the BFF
// here -- every request is intercepted and answered with a canned, minimal-but-valid response so
// each screen can mount and render real DOM/CSS in a real browser, without needing live data.
//
// Design: a small exact-path registry covers every screen these E2E journeys touch; anything not
// explicitly registered gets a benign 200 fallback (an empty object/array) rather than hanging or
// 404ing, so navigating to a not-yet-asserted-on view doesn't break the shared shell/nav journey.

export interface Staff {
  id: string;
  username: string;
  mfaEnrolled: boolean;
  disabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
}

export const MOCK_STAFF: Staff = {
  id: 'staff-1',
  username: 'e2e-operator',
  mfaEnrolled: true,
  disabled: false,
  mustSetPassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// One settings category per view the app shell can route to (REQ-F001-002 View union), each with
// a small, representative mix of control types so a rendered settings screen exercises DS
// `Input` (text control) and DS `Select` (a control with a real option set).
function settingsCategories() {
  const make = (id: string, label: string) => ({
    id,
    label,
    controls: [
      {
        id: `${id}.provider`,
        label: `${label} — Provider`,
        type: 'select' as const,
        secret: false,
        value: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
        ],
      },
      {
        id: `${id}.openai.apiKey`,
        label: `${label} — Openai — Api Key`,
        type: 'secret' as const,
        secret: true,
        set: true,
      },
      {
        id: `${id}.openai.model`,
        label: `${label} — Openai — Model`,
        type: 'text' as const,
        secret: false,
        value: 'gpt-4o-mini',
      },
    ],
  });
  return [
    make('llm', 'LLM Preference'),
    make('vectorDb', 'Vector Database'),
    make('embedding', 'Embedder Preference'),
    make('tts', 'Voice & Speech'),
    make('stt', 'Transcription'),
    make('agentSkills', 'Agent Skills'),
    make('security', 'Security'),
  ];
}

export const MOCK_WORKSPACE = {
  id: 'ws-e2e-1',
  displayName: 'E2E Test Workspace',
  llmProvider: null,
  llmModel: null,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Installs the default /api/* mock layer on `page`. Call once per test, before navigating.
 * Route handlers are page-scoped, so this is naturally isolated per test (no shared state).
 */
export async function installApiMocks(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (method === 'GET' && path === '/api/auth/me') {
      return json(route, { staff: MOCK_STAFF });
    }
    if (method === 'GET' && path === '/api/multi-user-status') {
      return json(route, { enabled: true });
    }
    if (method === 'GET' && path === '/api/settings') {
      return json(route, { categories: settingsCategories() });
    }
    if (method === 'GET' && path === '/api/workspaces') {
      return json(route, [MOCK_WORKSPACE]);
    }
    if (method === 'GET' && path === '/api/users') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/api/invites') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/api/settings/raw') {
      return json(route, []);
    }
    if (method === 'GET' && path === '/api/diagnostics/vectors') {
      return json(route, { vectorCount: 0 });
    }
    if (method === 'GET' && path === '/api/oversight/chats') {
      return json(route, { chats: [], hasMore: false });
    }
    if (method === 'GET' && path === '/api/models/ollama') {
      return json(route, { available: false, models: [] });
    }

    // Benign fallback for anything else this smoke suite doesn't specifically assert on.
    if (method === 'GET') {
      return json(route, {});
    }
    return json(route, {}, 204);
  });
}
