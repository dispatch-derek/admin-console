// White-box unit tests for the append-only audit sink (src/audit/audit.ts, REQ-093/093a/094/099).
// Calls recordAudit() DIRECTLY with the auditRepo and redactSecrets module boundaries mocked, so it
// can pin the exact shape handed to auditRepo.insert() and the stdout mirror without any real SQLite
// write. `target` is always a Record<string, unknown> | null — codebase-wide convention, restored by
// a Phase 7 code-review remediation after a since-reverted F-005-local bare-string variant — and is
// JSON-stringified into the column; every caller (including F-005's feature-toggle service, which
// passes `{ featureKey }`, REQ-F005-038/059) uses this same object shape. This module has no prior
// dedicated unit-test file — every other suite exercises recordAudit() only incidentally through a
// route/service's full behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
vi.mock('../../src/store/repositories/audit.repo.js', () => ({
  auditRepo: { insert: (...args: unknown[]) => insert(...args) },
}));

const redactSecrets = vi.fn((v: unknown) => v);
vi.mock('../../src/engine/mappers.js', () => ({
  redactSecrets: (...args: unknown[]) => redactSecrets(...args),
}));

import { recordAudit } from '../../src/audit/audit.js';

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  redactSecrets.mockImplementation((v: unknown) => v);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('recordAudit — target column shape', () => {
  it('a null/omitted target is stored as null (not the string "null" or {})', () => {
    recordAudit({ actor: 'staff-1', action: 'workspace.update', outcome: 'success' });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ target: null }),
    );
  });

  it('an explicit null target is stored as null', () => {
    recordAudit({ actor: 'staff-1', action: 'workspace.update', outcome: 'success', target: null });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });

  it('a Record target is JSON-stringified into the target column (pre-existing baseline shape)', () => {
    recordAudit({ actor: 'staff-1', action: 'workspace.update', outcome: 'success', target: { id: 'ws-1' } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ target: JSON.stringify({ id: 'ws-1' }) }));
  });

  it('REQ-F005-038/059 — the feature-toggle target shape `{ featureKey }` is stored as the exact JSON object string, never a bare/quoted string', () => {
    recordAudit({ actor: 'staff-1', action: 'feature_toggle.set', outcome: 'success', target: { featureKey: 'billing.invoices' } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ target: JSON.stringify({ featureKey: 'billing.invoices' }) }));
    const call = insert.mock.calls[0]![0] as { target: string };
    // Specifically NOT the bare opaque string (the since-reverted F-005-local variant) and NOT a
    // JSON-quoted string — the column holds a JSON OBJECT string with the featureKey nested inside.
    expect(call.target).not.toBe('billing.invoices');
    expect(call.target).not.toBe(JSON.stringify('billing.invoices'));
    expect(JSON.parse(call.target)).toEqual({ featureKey: 'billing.invoices' });
  });

  it('a target object whose value contains characters that could be mistaken for raw JSON round-trips exactly through JSON.stringify/parse', () => {
    const opaque = 'a/b c#{"not":"json-parsed"}';
    recordAudit({ actor: 'staff-1', action: 'feature_toggle.clear', outcome: 'success', target: { featureKey: opaque } });
    const call = insert.mock.calls[0]![0] as { target: string };
    expect(JSON.parse(call.target)).toEqual({ featureKey: opaque });
  });

  it('a target object whose featureKey is the empty string is stored with that value intact, not coerced to null/omitted', () => {
    recordAudit({ actor: 'staff-1', action: 'feature_toggle.set', outcome: 'success', target: { featureKey: '' } });
    const call = insert.mock.calls[0]![0] as { target: string };
    expect(JSON.parse(call.target)).toEqual({ featureKey: '' });
  });

  it('an empty object target ({}) is JSON-stringified as "{}", not coerced to null', () => {
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success', target: {} });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ target: '{}' }));
  });
});

describe('recordAudit — detail column (redaction + json/null)', () => {
  it('an omitted detail is stored as null and redactSecrets is never called', () => {
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success' });
    expect(redactSecrets).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ detail: null }));
  });

  it('a defined detail is passed through redactSecrets and JSON-stringified', () => {
    redactSecrets.mockReturnValue({ verified: true });
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success', detail: { verified: true, apiKey: 'secret' } });
    expect(redactSecrets).toHaveBeenCalledWith({ verified: true, apiKey: 'secret' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ detail: JSON.stringify({ verified: true }) }));
  });

  it('a detail that redacts down to null is stored as null, not the string "null"', () => {
    redactSecrets.mockReturnValue(null);
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success', detail: 'irrelevant' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ detail: null }));
  });
});

describe('recordAudit — actor/action/outcome/ts passthrough', () => {
  it('passes actor, action, and outcome through unchanged and stamps an ISO-8601 ts', () => {
    recordAudit({ actor: 'staff-42', action: 'feature_toggle.set', outcome: 'failure' });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'staff-42',
        action: 'feature_toggle.set',
        outcome: 'failure',
        ts: expect.stringMatching(ISO_8601),
      }),
    );
  });

  it('a null actor (pre-auth event) is passed through as null, not coerced to a string', () => {
    recordAudit({ actor: null, action: 'auth.login', outcome: 'success' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actor: null }));
  });

  it('calls auditRepo.insert exactly once per recordAudit call', () => {
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success' });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('recordAudit — stdout structured mirror (REQ-099)', () => {
  it('writes one JSON line to stdout carrying the same actor/action/outcome/target/detail', () => {
    recordAudit({ actor: 'staff-1', action: 'feature_toggle.set', outcome: 'success', target: { featureKey: 'k' }, detail: { enabled: true } });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = stdoutSpy.mock.calls[0]![0] as string;
    expect(written.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written);
    expect(parsed).toMatchObject({
      log: 'audit',
      actor: 'staff-1',
      action: 'feature_toggle.set',
      outcome: 'success',
      target: { featureKey: 'k' },
      detail: { enabled: true },
    });
    expect(parsed.ts).toMatch(ISO_8601);
  });

  it('the stdout mirror carries the RAW (pre-JSON.stringify) target value, not the DB column string', () => {
    recordAudit({ actor: 'staff-1', action: 'a', outcome: 'success', target: { id: 'ws-1' } });
    const written = stdoutSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(written);
    // The stdout mirror embeds the object directly (nested JSON), not the DB's stringified form.
    expect(parsed.target).toEqual({ id: 'ws-1' });
  });
});
