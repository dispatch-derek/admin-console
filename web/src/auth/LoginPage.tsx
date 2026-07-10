// The two-step login FSM (§3.2). Factor 1 (username + password) yields a stage; we branch on it
// to set-password, MFA-code, or enrollment. A "use a recovery code" path swaps the TOTP factor for
// a single-use recovery code. All failures render the BFF { message } verbatim via ErrorBanner.

import { useState } from 'react';
import * as api from '../api/client';
import { ApiError } from '../api/errors';
import { ErrorBanner } from '../components/ErrorBanner';
import { EnrollMfa } from './EnrollMfa';
import { Input, Button } from '../design-system';
import { isSessionResult, type LoginStage, type StageOrSession, type Staff } from '../api/types';

type Phase = 'credentials' | 'setPassword' | 'mfa' | 'enroll' | 'recovery';

interface LoginPageProps {
  onAuthenticated: (staff: Staff) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [phase, setPhase] = useState<Phase>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<LoginStage | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyStage(s: LoginStage) {
    setStage(s);
    setPhase(s.stage);
  }

  function handleResult(result: StageOrSession) {
    if (isSessionResult(result)) {
      onAuthenticated(result.staff);
    } else {
      applyStage(result);
    }
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const submitCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => applyStage(await api.login(username, password)));
  };

  const submitSetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stage) return;
    void run(async () => applyStage(await api.setPassword(stage.challengeId, newPassword)));
  };

  const submitMfa = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stage) return;
    void run(async () => {
      const { staff } = await api.mfa(stage.challengeId, code.trim());
      onAuthenticated(staff);
    });
  };

  const submitRecovery = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => handleResult(await api.recovery(username, password, recoveryCode.trim())));
  };

  if (phase === 'enroll' && stage) {
    return (
      <div className="ac-auth-screen">
        <EnrollMfa
          challengeId={stage.challengeId}
          secret={stage.secret}
          qr={stage.qr}
          otpauthUri={stage.otpauthUri}
          onComplete={onAuthenticated}
        />
      </div>
    );
  }

  return (
    <div className="ac-auth-screen">
      <div className="ac-auth-panel">
        <h1>Admin Console</h1>

        {phase === 'credentials' && (
          <form onSubmit={submitCredentials}>
            <Input
              label="Username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <ErrorBanner message={error} />
            <Button variant="login" type="submit" disabled={busy || !username || !password}>
              Sign in
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                setPhase('recovery');
              }}
            >
              Use a recovery code
            </Button>
          </form>
        )}

        {phase === 'setPassword' && (
          <form onSubmit={submitSetPassword}>
            <h2>Set a new password</h2>
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <ErrorBanner message={error} />
            <Button variant="login" type="submit" disabled={busy || newPassword === ''}>
              Set password
            </Button>
          </form>
        )}

        {phase === 'mfa' && (
          <form onSubmit={submitMfa}>
            <h2>Enter your authenticator code</h2>
            <Input
              label="6-digit code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <ErrorBanner message={error} />
            <Button variant="login" type="submit" disabled={busy || code.trim() === ''}>
              Verify
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                setPhase('recovery');
              }}
            >
              Use a recovery code
            </Button>
          </form>
        )}

        {phase === 'recovery' && (
          <form onSubmit={submitRecovery}>
            <h2>Sign in with a recovery code</h2>
            <Input
              label="Username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="Recovery code"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
            <ErrorBanner message={error} />
            <Button
              variant="login"
              type="submit"
              disabled={busy || !username || !password || recoveryCode.trim() === ''}
            >
              Sign in
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                setPhase('credentials');
              }}
            >
              Back
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
