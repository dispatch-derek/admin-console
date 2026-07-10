// Multi-user precondition gate (§6.1, REQ-040). Before rendering any §6 user-management view the
// console reads GET /api/multi-user-status. When multi-user mode is OFF, ALL §6 controls are
// withheld and an out-of-band notice is shown — the console offers NO enable action, because
// enabling multi-user mode is an out-of-band operation (REQ-073/085, BL-2). The live upstream
// state is reflected, never a cached assumption (REQ-090).

import { useEffect, useState, type ReactNode } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';

interface MultiUserGateProps {
  children: ReactNode;
}

export function MultiUserGate({ children }: MultiUserGateProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getMultiUserStatus()
      .then((s) => active && setEnabled(s.enabled))
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Failed to load status'),
      );
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (enabled === null) return <p>Loading…</p>;

  if (!enabled) {
    return (
      <div className="ac-multi-user-disabled" role="status">
        <h2>User management unavailable</h2>
        <p>
          Multi-user mode is not enabled on this instance. User, invite, and membership management
          are unavailable. Multi-user mode must be enabled out-of-band — this console does not
          enable or disable it.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
