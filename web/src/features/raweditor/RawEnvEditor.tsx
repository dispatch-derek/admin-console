// Raw environment editor (§7.11, REQ-078a–f, REQ-088a). Lists every accepted key and its current
// state FROM THE BFF RESPONSE — the valid-key list is never hardcoded in the frontend (REQ-078b/
// 078e). Secret keys show set/not-set only (never a value, REQ-078a). Write controls are inert
// until advanced mode is enabled (REQ-078). A write is confirmed via a masked diff + typed token
// (REQ-078c) and issued only on an exact token match; only keys the BFF returned can be written.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { SetNotSetBadge } from '../../components/SetNotSetBadge';
import { AdvancedModeGate } from './AdvancedModeGate';
import { MaskedDiffConfirm, type RawWriteRow } from './MaskedDiffConfirm';
import { Button, Table, Input } from '../../design-system';
import type { RawEnvEntry } from '../../api/types';

// Secret keys are exactly those the BFF reports as set/notSet (it withholds their value).
function isSecretEntry(entry: RawEnvEntry): boolean {
  return entry.state === 'set' || entry.state === 'notSet';
}

export function RawEnvEditor() {
  const [entries, setEntries] = useState<RawEnvEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Focus fallback for a successful write (REQ-F002-034): a successful write clears the drafts,
  // which disables the "Review & write" trigger in the same commit that closes the dialog. Focus
  // returns to this actions landmark — adjacent to the trigger and the post-write result — rather
  // than dropping to <body>.
  const actionsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setEntries(await api.getRawEnv());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load env keys');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entryByKey = useMemo(() => {
    const map = new Map<string, RawEnvEntry>();
    for (const e of entries) map.set(e.key, e);
    return map;
  }, [entries]);

  // Pending writes: keys whose draft is non-empty. Keys not in `entries` cannot be written.
  const rows = useMemo<RawWriteRow[]>(() => {
    const out: RawWriteRow[] = [];
    for (const [key, value] of Object.entries(drafts)) {
      if (value === '') continue;
      const entry = entryByKey.get(key);
      if (!entry) continue;
      out.push({ key, newValue: value, secret: isSecretEntry(entry) });
    }
    return out;
  }, [drafts, entryByKey]);

  async function confirmWrite() {
    setWriteError(null);
    setResult(null);
    setBusy(true);
    try {
      const writes = rows.map((r) => ({ key: r.key, value: r.newValue }));
      const res = await api.putRawEnv(writes);
      setResult(
        res.verified
          ? `Wrote ${res.keys.length} key(s); all verified.`
          : `Wrote ${res.keys.length} key(s); some were submitted but not verified.`,
      );
      setDrafts({});
      setConfirming(false);
      await load();
    } catch (err) {
      setWriteError(err instanceof ApiError ? err.message : 'Write failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ac-raw-editor">
      <AdvancedModeGate advanced={advanced} onChange={setAdvanced} />
      <ErrorBanner message={loadError} />
      {result && <p className="ac-success">{result}</p>}

      <Table columns={['Key', 'Current state', 'New value']}>
        {entries.map((entry) => (
          <Table.Row key={entry.key}>
            <Table.Cell>
              <code>{entry.key}</code>
            </Table.Cell>
            <Table.Cell>
              {isSecretEntry(entry) ? (
                <SetNotSetBadge set={entry.state === 'set'} />
              ) : entry.state === 'value' ? (
                <code>{entry.value}</code>
              ) : (
                <em>not returned / unknown</em>
              )}
            </Table.Cell>
            <Table.Cell>
              <Input
                type={isSecretEntry(entry) ? 'password' : 'text'}
                value={drafts[entry.key] ?? ''}
                disabled={!advanced}
                placeholder={isSecretEntry(entry) ? 'new value (write-only)' : ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [entry.key]: e.target.value }))}
              />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table>

      <div className="ac-raw-actions" ref={actionsRef} tabIndex={-1}>
        <Button
          variant="solid"
          disabled={!advanced || rows.length === 0 || busy}
          onClick={() => setConfirming(true)}
        >
          Review & write ({rows.length})
        </Button>
      </div>

      {confirming && (
        <MaskedDiffConfirm
          rows={rows}
          error={writeError}
          busy={busy}
          fallbackFocusRef={actionsRef}
          onConfirm={confirmWrite}
          onCancel={() => {
            setConfirming(false);
            setWriteError(null);
          }}
        />
      )}
    </div>
  );
}
