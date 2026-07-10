// Non-color-only sync-state encoding (REQ-F002-033). Each state pairs a glyph (decorative,
// aria-hidden) + a text label (the accessible name) + a color class, so the four states remain
// distinguishable in grayscale / for color-blind users.

import type { BaselineSyncState } from '../../api/types';

const META: Record<BaselineSyncState, { glyph: string; label: string; cls: string }> = {
  synced: { glyph: '✓', label: 'Synced', cls: 'sync-chip-synced' },
  stale: { glyph: '↻', label: 'Stale — re-sync needed', cls: 'sync-chip-stale' },
  overridden: { glyph: '✎', label: 'Overridden', cls: 'sync-chip-overridden' },
  'never-applied': { glyph: '○', label: 'Never applied', cls: 'sync-chip-neverapplied' },
};

export function SyncStateChip({ state }: { state: BaselineSyncState }) {
  const meta = META[state];
  return (
    <span className={`sync-chip ${meta.cls}`}>
      <span className="sync-chip-glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}
