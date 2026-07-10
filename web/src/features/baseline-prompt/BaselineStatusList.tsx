// Drift/status roster (REQ-F002-024/023/026/033). One row per live workspace with its sync state
// (via SyncStateChip — non-color-only) and whether the console stores a per-workspace remainder.
// Newly created workspaces surface as `never-applied` (REQ-F002-026). Bare read — no mode, no token.

import type { BaselineStatusView, BaselineSyncState } from '../../api/types';
import { ErrorBanner } from '../../components/ErrorBanner';
import { SyncStateChip } from './SyncStateChip';
import { Button } from '../../design-system';

interface Props {
  status: BaselineStatusView | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const ORDER: BaselineSyncState[] = ['synced', 'stale', 'overridden', 'never-applied'];
const COUNT_LABEL: Record<BaselineSyncState, string> = {
  synced: 'synced',
  stale: 'stale',
  overridden: 'overridden',
  'never-applied': 'never applied',
};

export function BaselineStatusList({ status, loading, error, onRefresh }: Props) {
  return (
    <section className="baseline-region" aria-labelledby="baseline-status-heading">
      <div className="baseline-region-header">
        <h2 id="baseline-status-heading">Workspace drift</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <ErrorBanner message={error} />

      {loading && !status ? (
        <p className="baseline-muted">Loading…</p>
      ) : status && status.workspaces.length > 0 ? (
        <>
          <p className="baseline-counts">
            {ORDER.map((s, i) => (
              <span key={s}>
                {i > 0 ? ' · ' : ''}
                <strong>{status.counts[s]}</strong> {COUNT_LABEL[s]}
              </span>
            ))}
          </p>
          {/* Explicit ARIA roles mirror the implicit table roles so that the <40rem stacked-card
              layout (which overrides `display` on tr/td) does not strip table semantics from AT
              (REQ-F002-034). */}
          <table className="baseline-status-table" role="table">
            <caption className="sr-only">
              Sync state of every live workspace against the current baseline.
            </caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Workspace
                </th>
                <th scope="col" role="columnheader">
                  Sync state
                </th>
                <th scope="col" role="columnheader">
                  Workspace-specific text
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {status.workspaces.map((ws) => (
                <tr key={ws.workspaceId} role="row">
                  <td data-label="Workspace" role="cell">
                    {ws.displayName}
                  </td>
                  <td data-label="Sync state" role="cell">
                    <SyncStateChip state={ws.syncState} />
                  </td>
                  <td data-label="Workspace-specific text" role="cell">
                    {ws.hasWorkspaceRemainder ? 'Preserved' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="baseline-muted">No workspaces found.</p>
      )}
    </section>
  );
}
