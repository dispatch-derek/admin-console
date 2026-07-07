// Diagnostics (§7.9, REQ-074). Shows the instance vector count and, on demand, the masked
// env-dump. The env-dump values are already masked upstream; the console displays them AS-IS and
// performs no additional processing.

import { useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';

export function DiagnosticsPage() {
  const [vectorCount, setVectorCount] = useState<number | null>(null);
  const [envDump, setEnvDump] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dumpError, setDumpError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getVectorCount()
      .then((r) => active && setVectorCount(r.vectorCount))
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Failed to load count'),
      );
    return () => {
      active = false;
    };
  }, []);

  async function loadDump() {
    setDumpError(null);
    setBusy(true);
    try {
      setEnvDump(await api.getEnvDump());
    } catch (err) {
      setDumpError(err instanceof ApiError ? err.message : 'Failed to load env dump');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="diagnostics-page">
      <ErrorBanner message={error} />

      <section>
        <h3>Vector count</h3>
        <p>{vectorCount === null ? 'Loading…' : vectorCount.toLocaleString()}</p>
      </section>

      <section>
        <h3>Masked environment dump</h3>
        <button type="button" onClick={loadDump} disabled={busy}>
          Load env dump
        </button>
        <ErrorBanner message={dumpError} />
        {envDump && (
          <table className="entity-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value (masked)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(envDump).map(([key, value]) => (
                <tr key={key}>
                  <td>
                    <code>{key}</code>
                  </td>
                  <td>
                    <code>{String(value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
