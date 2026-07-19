// Static source-tree scans for F-004 boundary/non-goal requirements that are best asserted
// structurally rather than behaviorally (mirrors the established static-scan convention already
// used across this repo's F-001/F-002/F-005 suites, e.g. `web/src/leakage.test.ts`).
// Covers: REQ-F004-006 (no web/ change), REQ-F004-009/010/041 (listUnpublished has no
// non-test/non-relay-forbidden caller), REQ-F004-049 (no transport-specific logic leaks into the
// orchestration layer), REQ-F004-022 (no route/service touches the transport axis),
// REQ-F004-028 (EVENT_BUS_URL never reaches a route response / the browser), REQ-F004-054
// (the relay never references a second application's database).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const bffSrc = join(repoRoot, 'bff', 'src');
const webSrc = join(repoRoot, 'web', 'src');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function grep(files: string[], pattern: RegExp): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

describe('REQ-F004-006 — F-004 introduces ZERO changes under web/', () => {
  it('no web/src file references any F-004 relay-only token (EVENT_BUS_URL, HttpPeerTransport, outbox relay internals)', () => {
    const files = walk(webSrc);
    const forbidden = /EVENT_BUS_URL|HttpPeerTransport|outbox_meta|deriveOrderingKey|relay\/drainer|EVENT_BUS_TRANSPORT/;
    const hits = grep(files, forbidden);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});

describe('REQ-F004-009/010/041 — the grounded listUnpublished has no non-repo, non-test caller', () => {
  it('listUnpublished is referenced ONLY inside outbox.repo.ts itself (its own definition) among bff/src/** files', () => {
    const files = walk(bffSrc);
    const hits = grep(files, /listUnpublished/).filter((h) => !h.file.endsWith(join('repositories', 'outbox.repo.ts')));
    expect(hits, `listUnpublished must not be called outside outbox.repo.ts (drain source must be selectEligible): ${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('REQ-F004-049 — no transport-specific logic leaks into the drain/orchestration layer', () => {
  const drainerPath = join(bffSrc, 'relay', 'drainer.ts');
  it.skipIf(!existsSync(drainerPath))(
    'drainer.ts imports no HTTP client, no HttpPeerTransport, and does not parse a peer/URL list itself',
    () => {
      const text = readFileSync(drainerPath, 'utf8');
      expect(text).not.toMatch(/HttpPeerTransport/);
      expect(text).not.toMatch(/from ['"]node:http['"]/);
      expect(text).not.toMatch(/EVENT_BUS_URL/);
      expect(text).not.toMatch(/\.split\(['"],['"]\)/); // a literal comma-split (peer-list parsing) has no business here
    },
  );

  it('flags pre-implementation state explicitly rather than silently skipping (RED signal until drainer.ts exists)', () => {
    if (!existsSync(drainerPath)) {
      expect.fail('bff/src/relay/drainer.ts does not exist yet — the no-leak static check above cannot run. Expected pre-implementation RED signal.');
    }
  });
});

describe('REQ-F004-022 — mutating routes/services are untouched by the transport axis', () => {
  it('no file under bff/src/routes or bff/src/services imports anything from bff/src/relay/**', () => {
    const files = [...walk(join(bffSrc, 'routes')), ...walk(join(bffSrc, 'services'))];
    const hits = grep(files, /from ['"].*\/relay\//);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('emitAdminEvent (bff/src/events/emitter.ts) still calls getEventBus().publish — the seam is unchanged (REQ-F004-001)', () => {
    const text = readFileSync(join(bffSrc, 'events', 'emitter.ts'), 'utf8');
    expect(text).toMatch(/getEventBus\(\)\.publish/);
  });

  it('every mutating service still emits ONLY via emitAdminEvent (no direct getEventBus()/relay import in services/)', () => {
    const files = walk(join(bffSrc, 'services'));
    const hits = grep(files, /getEventBus\(|from ['"].*\/relay\//);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});

describe('REQ-F004-028 — EVENT_BUS_URL / transport config never reaches a route response', () => {
  it('no route handler under bff/src/routes references EVENT_BUS_URL / eventBusUrl / peerUrls', () => {
    const files = walk(join(bffSrc, 'routes'));
    const hits = grep(files, /EVENT_BUS_URL|eventBusUrl|peerUrls/);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});

describe('REQ-F004-054 — the relay is per-app: it never references a second application\'s database', () => {
  const relayDir = join(bffSrc, 'relay');
  it.skipIf(!existsSync(relayDir))('no file under bff/src/relay references customer-web-app or a hardcoded second DB path', () => {
    const files = walk(relayDir);
    const hits = grep(files, /customer-web-app/);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});
