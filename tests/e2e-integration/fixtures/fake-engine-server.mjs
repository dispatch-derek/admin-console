// Minimal fake AnythingLLM engine HTTP server for F-002 E2E testing.
//
// This is NOT a modification of bff/src: the BFF's engine adapter (bff/src/engine/adapter.ts)
// already talks to the engine purely over HTTP at a configurable ANYTHINGLLM_BASE_URL. There is
// no in-process fake-engine mode for a full separate-process server boot (only vi.mock() at the
// bff vitest layer, which cannot reach across process boundaries into a `tsx watch` dev server).
// This script stands in for a real AnythingLLM instance by implementing just the handful of
// `/api/v1/*` routes the F-002 flow exercises (list/get/update workspace), so the E2E suite can
// drive the BFF and web dev servers for real without requiring a real AnythingLLM deployment.
//
// Seeds two workspaces with different starting prompts so the F-002 preview/apply flow has a
// real per-workspace diff to render (one workspace with existing content -> prepend fan-out;
// one empty workspace -> baseline-alone fan-out).
//
// Exposes a test-only /__test__/patch-count endpoint so the E2E test can assert "zero engine
// writes" after a rejected apply without polling/sleeping.

import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_ENGINE_PORT ?? 3101);

/** @type {Map<string, {id:number, name:string, slug:string, chatProvider:string|null, chatModel:string|null, chatMode:string, openAiTemp:number|null, openAiHistory:number, openAiPrompt:string|null, similarityThreshold:number|null, topN:number|null, agentProvider:string|null, agentModel:string|null, queryRefusalResponse:string|null, vectorSearchMode:string|null, pfpFilename:string|null}>} */
const workspaces = new Map();

workspaces.set('acme-support', {
  id: 1,
  name: 'Acme Support',
  slug: 'acme-support',
  chatProvider: 'openai',
  chatModel: 'gpt-4o-mini',
  chatMode: 'chat',
  openAiTemp: 0.7,
  openAiHistory: 20,
  openAiPrompt: 'Answer only in French.',
  similarityThreshold: 0.25,
  topN: 4,
  agentProvider: null,
  agentModel: null,
  queryRefusalResponse: null,
  vectorSearchMode: null,
  pfpFilename: null,
});

workspaces.set('acme-sales', {
  id: 2,
  name: 'Acme Sales',
  slug: 'acme-sales',
  chatProvider: 'openai',
  chatModel: 'gpt-4o-mini',
  chatMode: 'chat',
  openAiTemp: 0.7,
  openAiHistory: 20,
  openAiPrompt: '',
  similarityThreshold: 0.25,
  topN: 4,
  agentProvider: null,
  agentModel: null,
  queryRefusalResponse: null,
  vectorSearchMode: null,
  pfpFilename: null,
});

let patchCount = 0;

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    // --- test-only introspection (not part of the AnythingLLM surface) ---
    if (path === '/__test__/patch-count' && method === 'GET') {
      return send(res, 200, { patchCount });
    }
    if (path === '/__test__/reset' && method === 'POST') {
      patchCount = 0;
      return send(res, 200, { ok: true });
    }

    if (path === '/api/v1/workspaces' && method === 'GET') {
      return send(res, 200, { workspaces: Array.from(workspaces.values()) });
    }

    const workspaceMatch = path.match(/^\/api\/v1\/workspace\/([^/]+)$/);
    if (workspaceMatch && method === 'GET') {
      const slug = decodeURIComponent(workspaceMatch[1]);
      const ws = workspaces.get(slug);
      if (!ws) return send(res, 404, { error: 'not found' });
      return send(res, 200, { workspace: ws });
    }

    const updateMatch = path.match(/^\/api\/v1\/workspace\/([^/]+)\/update$/);
    if (updateMatch && method === 'POST') {
      const slug = decodeURIComponent(updateMatch[1]);
      const ws = workspaces.get(slug);
      if (!ws) return send(res, 404, { error: 'not found' });
      const patch = await readJsonBody(req);
      Object.assign(ws, patch);
      patchCount += 1;
      return send(res, 200, { workspace: ws });
    }

    // Minimal stand-ins so other, unrelated app pages (loaded incidentally on the default
    // landing view before the test navigates to Baseline Prompt) don't hang on a connection
    // reset -- these are outside F-002's scope and always return a benign empty shape.
    if (path === '/api/v1/system' && method === 'GET') {
      return send(res, 200, { settings: {} });
    }
    if (path === '/api/v1/admin/is-multi-user-mode' && method === 'GET') {
      return send(res, 200, { isMultiUser: false });
    }
    if (path === '/api/v1/system/vector-count' && method === 'GET') {
      return send(res, 200, { vectorCount: 0 });
    }
    if (path === '/api/v1/system/env-dump' && method === 'GET') {
      return send(res, 200, {});
    }
    if (path === '/api/v1/documents' && method === 'GET') {
      return send(res, 200, { documents: [] });
    }

    return send(res, 404, { error: 'not found (fake engine stub)' });
  } catch (err) {
    return send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fake-engine] listening on :${PORT}`);
});
