// Secret set/not-set indicator (REQ-060). Stored secret values are never displayed — only whether
// a value is currently set. Migrated onto the recreated DS Badge primitive (REQ-F001-020): set→
// success tone, not-set→neutral tone. The DS badge tokens back the tones; the retired ad-hoc status
// property is no longer referenced (REQ-F001-048). Public contract ({ set: boolean }) unchanged.
import { Badge } from '../design-system';

interface SetNotSetBadgeProps {
  set: boolean;
}

export function SetNotSetBadge({ set }: SetNotSetBadgeProps) {
  return <Badge tone={set ? 'success' : 'neutral'}>{set ? 'set' : 'not set'}</Badge>;
}
