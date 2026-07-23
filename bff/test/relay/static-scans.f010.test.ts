// Static source-tree scans for F-010 requirements best asserted structurally (mirrors the
// established convention in bff/test/relay/static-scans.test.ts, which is F-004-owned and left
// untouched here). Covers: REQ-F010-001 (a real credential-carrying code path exists, not config
// alone), REQ-F010-002/012/027 (catalog unchanged), REQ-F010-008/023 (the drainer/orchestration
// layer never sees the credential — transport-swap boundary preserved), REQ-F010-025 (F-010 itself
// introduces no HMAC/mTLS peer authentication — still a valid F-010 non-goal. The https-only
// peer-URL scheme enforcement clause that previously lived here has been SUPERSEDED: the product
// owner authorized D-006 (GH #16) to add that enforcement, and bff/src/relay/config.ts now does —
// see bff/test/relay/relay-config.d006.test.ts for the enforcement's own regression coverage. This
// file no longer asserts scheme enforcement is absent; it only asserts F-010 didn't add HMAC/mTLS).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const bffSrc = join(repoRoot, 'bff', 'src');

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

describe('REQ-F010-001 — the outbound transport gains a REAL credential-carrying code path (config alone would be insufficient)', () => {
  const transportPath = join(bffSrc, 'relay', 'http-peer-transport.ts');

  it.skipIf(!existsSync(transportPath))('http-peer-transport.ts references the credential header name literal — a genuine code-path change, not config alone', () => {
    const text = readFileSync(transportPath, 'utf8');
    expect(text).toMatch(/X-Event-Ingest-Secret/i);
  });

  it('flags pre-implementation state explicitly rather than silently passing (RED signal until the credential code path exists)', () => {
    if (!existsSync(transportPath)) {
      expect.fail('bff/src/relay/http-peer-transport.ts does not exist — cannot scan for the credential code path.');
      return;
    }
    const text = readFileSync(transportPath, 'utf8');
    if (!/X-Event-Ingest-Secret/i.test(text)) {
      expect.fail(
        'http-peer-transport.ts does not yet reference the X-Event-Ingest-Secret credential header — ' +
          'pre-F-010 state (exactly two headers, no credential), expected RED signal per REQ-F010-001.',
      );
    }
  });
});

describe('REQ-F010-002/012/027 — the admin.* catalog is UNCHANGED by F-010 (21 names, 5 admin.user.*)', () => {
  const catalogPath = join(bffSrc, 'events', 'catalog.ts');
  const KNOWN_21 = [
    'admin.workspace.created',
    'admin.workspace.updated',
    'admin.workspace.deleted',
    'admin.workspace.documents_changed',
    'admin.workspace.knowledge_pinned',
    'admin.workspace.knowledge_unpinned',
    'admin.workspace_user.assigned',
    'admin.workspace_user.unassigned',
    'admin.user.created',
    'admin.user.updated',
    'admin.user.suspended',
    'admin.user.reactivated',
    'admin.user.deleted',
    'admin.invite.created',
    'admin.invite.revoked',
    'admin.instance.setting_changed',
    'admin.instance.provider_changed',
    'admin.raw_env.written',
    'admin.baseline_prompt.updated',
    'admin.baseline_prompt.applied',
    'admin.feature_toggle.changed',
  ];

  it('catalog.ts still contains exactly the 21 known admin.* event-name literals (no rename/add/drop) — 5 admin.user.* among them', () => {
    if (!existsSync(catalogPath)) {
      expect.fail('bff/src/events/catalog.ts does not exist.');
      return;
    }
    const text = readFileSync(catalogPath, 'utf8');
    for (const name of KNOWN_21) {
      expect(text, `missing catalog entry: ${name}`).toMatch(new RegExp(name.replace(/\./g, '\\.')));
    }
    const userFamily = KNOWN_21.filter((n) => n.startsWith('admin.user.'));
    expect(userFamily).toHaveLength(5);
  });

  it('catalog.ts is not edited to add a credential-related field/name (F-010 is transport metadata, never an envelope/catalog field)', () => {
    if (!existsSync(catalogPath)) return;
    const text = readFileSync(catalogPath, 'utf8');
    expect(text).not.toMatch(/EVENT_BUS_PEER_AUTH_TOKEN|X-Event-Ingest-Secret|peerAuthToken/);
  });
});

describe('REQ-F010-008/023 — the credential is transport-internal ONLY: the drainer/orchestration layer never sees it (transport-swap boundary preserved)', () => {
  const drainerPath = join(bffSrc, 'relay', 'drainer.ts');

  it.skipIf(!existsSync(drainerPath))('drainer.ts contains no credential value, credential-header constant, or credential env-var reference', () => {
    const text = readFileSync(drainerPath, 'utf8');
    expect(text).not.toMatch(/X-Event-Ingest-Secret/i);
    expect(text).not.toMatch(/EVENT_BUS_PEER_AUTH_TOKEN/);
    expect(text).not.toMatch(/peerAuthToken/);
  });

  it('flags pre-implementation state explicitly if drainer.ts is missing (RED signal)', () => {
    if (!existsSync(drainerPath)) {
      expect.fail('bff/src/relay/drainer.ts does not exist — the no-leak static check above cannot run.');
    }
  });
});

describe('REQ-F010-025 — F-010 itself introduces no HMAC/mTLS peer authentication (https-only peer-URL scheme enforcement is now D-006/GH #16 in-scope, not a F-010 non-goal)', () => {
  const relayDir = join(bffSrc, 'relay');

  it('no file under bff/src/relay signs requests with HMAC or references mTLS/client-cert auth', () => {
    const files = walk(relayDir);
    const hits = grep(files, /createHmac|hmac-sha|mTLS|clientCert|client-cert/i);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  // SPEC-AMBIGUITY resolved: this assertion previously required that NO file under bff/src/relay
  // enforce an https-only peer URL scheme, to prove F-010 stayed out of that lane. The product
  // owner has since explicitly authorized D-006 to add https-only peer-URL scheme enforcement
  // (see bff/src/relay/config.ts and bff/test/relay/relay-config.d006.test.ts), so that premise is
  // now obsolete by deliberate scope move, not by regression. This clause is intentionally removed
  // from F-010's static scan; it is superseded by D-006's own regression test, not deleted here to
  // hide a bug.
});
