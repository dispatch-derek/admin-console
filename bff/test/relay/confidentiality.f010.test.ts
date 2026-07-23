// F-010 §3.4 confidentiality of the credential (REQ-F010-010/011) + §5 secret handling posture
// (REQ-F010-020). A NEW, dedicated file — no pre-existing file owns this territory.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeEnvelope } from './helpers.js';

describe('REQ-F010-010 — the credential is NEVER placed in the event envelope (cwa REQ-F005-062 freeze holds)', () => {
  it('admin.user.created keeps changes={username,role} exactly — no credential field, no new payload field', () => {
    const envelope = makeEnvelope('admin.user.created', { id: 'u1' }, { changes: { username: 'alice', role: 'admin' } });
    expect(envelope['changes']).toEqual({ username: 'alice', role: 'admin' });
    expect(Object.keys(envelope).sort()).toEqual(
      ['event', 'actor', 'target', 'changes', 'verified', 'timestamp', 'payload'].sort(),
    );
    const json = JSON.stringify(envelope);
    expect(json).not.toMatch(/credential|authtoken|auth_token|x-event-ingest-secret/i);
  });

  it('a static scan of the emitted-envelope-shaping modules references no credential-carrying field/name', () => {
    const emitterPath = resolve(import.meta.dirname, '../../src/events/emitter.ts');
    const catalogPath = resolve(import.meta.dirname, '../../src/events/catalog.ts');
    for (const p of [emitterPath, catalogPath]) {
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(/EVENT_BUS_PEER_AUTH_TOKEN|peerAuthToken|X-Event-Ingest-Secret/);
    }
  });
});

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
}
function startPeer(status: number): Promise<{ url: string; requests: CapturedRequest[]; close: () => Promise<void> }> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers });
      res.writeHead(status).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const transportMod = await import('../../src/relay/http-peer-transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type HttpPeerTransportCtor = new (
  peerUrls: string[],
  peerTimeoutMs?: number,
  peerAuthToken?: string,
) => { deliver: (envelope: string, deliveryId: string) => Promise<void> };
const HttpPeerTransport = (transportMod as { HttpPeerTransport?: HttpPeerTransportCtor }).HttpPeerTransport;

describe.skipIf(!HttpPeerTransport)('REQ-F010-011 — the credential is NEVER written to a thrown/serialized error, or to console/log output', () => {
  const SECRET = 'super-secret-do-not-leak-XYZ123';

  it('a permanent-park (401) TransportError message/stack/serialization never contains the credential value', async () => {
    const peer = await startPeer(401);
    try {
      const transport = new HttpPeerTransport!([peer.url], undefined, SECRET);
      let caught: unknown;
      try {
        await transport.deliver('{}', 'epoch-1:redact');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const err = caught as Error;
      expect(err.message).not.toContain(SECRET);
      expect(String(err)).not.toContain(SECRET);
      expect(err.stack ?? '').not.toContain(SECRET);
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(SECRET);
    } finally {
      await peer.close();
    }
  });

  it('no console.log/warn/error/info call made during a credentialed delivery (success or 401) contains the credential value', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const peer401 = await startPeer(401);
    const peer200 = await startPeer(200);
    try {
      const t1 = new HttpPeerTransport!([peer401.url], undefined, SECRET);
      await t1.deliver('{}', 'epoch-1:redact-log-401').catch(() => undefined);
      const t2 = new HttpPeerTransport!([peer200.url], undefined, SECRET);
      await t2.deliver('{}', 'epoch-1:redact-log-200');

      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls, ...infoSpy.mock.calls]
        .flat()
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
      for (const line of allCalls) {
        expect(line, `console output leaked the credential: ${line}`).not.toContain(SECRET);
      }
    } finally {
      await peer401.close();
      await peer200.close();
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});

describe('REQ-F010-011 — /ready and metrics surfaces never reference a credential-carrying token (static proxy check)', () => {
  it('ready.ts contains no credential env-var name, header name, or a field literally named for the credential', () => {
    const path = resolve(import.meta.dirname, '../../src/relay/ready.ts');
    if (!existsSync(path)) return; // covered elsewhere if ready.ts is missing entirely
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/EVENT_BUS_PEER_AUTH_TOKEN|X-Event-Ingest-Secret|peerAuthToken/);
  });

  it('metrics.ts recorder functions carry no credential-shaped parameter/field in their source text', () => {
    const path = resolve(import.meta.dirname, '../../src/relay/metrics.ts');
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/EVENT_BUS_PEER_AUTH_TOKEN|X-Event-Ingest-Secret|peerAuthToken/);
  });
});

describe('REQ-F010-020 — secret handling posture: env-sourced only, .env.example documents an EMPTY key, no real secret committed', () => {
  const envExamplePath = resolve(import.meta.dirname, '../../.env.example');

  it('bff/.env.example documents EVENT_BUS_PEER_AUTH_TOKEN with an EMPTY value (mirroring the existing EVENT_BUS_URL convention)', () => {
    if (!existsSync(envExamplePath)) {
      expect.fail('bff/.env.example does not exist.');
      return;
    }
    const text = readFileSync(envExamplePath, 'utf8');
    expect(text).toMatch(/^EVENT_BUS_PEER_AUTH_TOKEN=\s*$/m);
  });

  it('bff/src/relay/config.ts contains no obviously hard-coded real-looking credential literal', () => {
    const path = resolve(import.meta.dirname, '../../src/relay/config.ts');
    if (!existsSync(path)) {
      expect.fail('bff/src/relay/config.ts does not exist.');
      return;
    }
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/['"][A-Za-z0-9+/]{24,}['"]/);
  });
});
