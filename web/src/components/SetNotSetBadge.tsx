// Secret set/not-set indicator (REQ-060). Stored secret values are never displayed — only whether
// a value is currently set.

interface SetNotSetBadgeProps {
  set: boolean;
}

export function SetNotSetBadge({ set }: SetNotSetBadgeProps) {
  return (
    <span className={set ? 'badge badge-set' : 'badge badge-notset'}>
      {set ? 'set' : 'not set'}
    </span>
  );
}
