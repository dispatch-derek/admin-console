// Masked-diff confirmation for a raw env write (§7.11 REQ-078c, §8 REQ-088a). Before the write is
// issued it shows a masked diff — one row per key as `key → new state`, with secret keys shown as
// "will be set/overwritten" (never the value) and non-secret keys showing the new value — and
// requires the operator to type a fixed on-screen confirmation token. The write is issued only on
// an exact token match (enforced by DangerConfirm's typed-token mode).

import { DangerConfirm } from '../../components/DangerConfirm';

export interface RawWriteRow {
  key: string;
  newValue: string;
  secret: boolean;
}

const CONFIRM_TOKEN = 'WRITE';

interface MaskedDiffConfirmProps {
  rows: RawWriteRow[];
  error?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MaskedDiffConfirm({ rows, error, busy, onConfirm, onCancel }: MaskedDiffConfirmProps) {
  return (
    <DangerConfirm
      title="Confirm raw environment write"
      target={`${rows.length} key${rows.length === 1 ? '' : 's'}`}
      consequence="These keys will be written directly to the engine environment. This can change instance-wide behavior and cannot be automatically undone."
      expectedToken={CONFIRM_TOKEN}
      tokenLabel="confirmation token"
      confirmLabel="Write keys"
      error={error}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="masked-diff">
        {rows.map((row) => (
          <li key={row.key}>
            <code>{row.key}</code> →{' '}
            {row.secret ? (
              <em>will be set / overwritten</em>
            ) : (
              <code>{row.newValue}</code>
            )}
          </li>
        ))}
      </ul>
    </DangerConfirm>
  );
}
