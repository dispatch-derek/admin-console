// MFA enrollment step (REQ-017). Shows the QR (as a data-URI <img>) plus the secret for manual
// entry, confirms a TOTP code against the pending secret, then reveals the one-time recovery codes
// behind an explicit "I've saved these" acknowledgement before the session proceeds.

import { useState } from 'react';
import * as api from '../api/client';
import { ApiError } from '../api/errors';
import { ErrorBanner } from '../components/ErrorBanner';
import { AcknowledgeCheckbox } from '../components/AcknowledgeCheckbox';
import { Input, Button } from '../design-system';
import type { Staff } from '../api/types';

interface EnrollMfaProps {
  challengeId: string;
  secret?: string;
  qr?: string;
  otpauthUri?: string;
  onComplete: (staff: Staff) => void;
}

export function EnrollMfa({ challengeId, secret, qr, otpauthUri, onComplete }: EnrollMfaProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.enroll(challengeId, code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setStaff(result.staff);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  // Recovery-code reveal stage: shown once, must be acknowledged before entering the console.
  if (recoveryCodes && staff) {
    return (
      <div className="ac-auth-panel">
        <h2>Save your recovery codes</h2>
        <p>
          These one-time recovery codes let you sign in if you lose your authenticator. They are
          shown only once. Store them somewhere safe.
        </p>
        <ul className="ac-recovery-codes">
          {recoveryCodes.map((rc) => (
            <li key={rc}>
              <code>{rc}</code>
            </li>
          ))}
        </ul>
        <AcknowledgeCheckbox checked={acknowledged} onChange={setAcknowledged}>
          I have saved these recovery codes
        </AcknowledgeCheckbox>
        <Button variant="login" disabled={!acknowledged} onClick={() => onComplete(staff)}>
          Continue to console
        </Button>
      </div>
    );
  }

  return (
    <div className="ac-auth-panel">
      <h2>Set up two-factor authentication</h2>
      <p>Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
      {qr ? (
        <img className="ac-mfa-qr" src={qr} alt="TOTP enrollment QR code" />
      ) : (
        <p>QR code unavailable — use the secret below for manual entry.</p>
      )}
      {secret && (
        <p className="ac-mfa-secret">
          Manual entry secret: <code>{secret}</code>
        </p>
      )}
      {otpauthUri && (
        <p className="ac-mfa-uri">
          <code>{otpauthUri}</code>
        </p>
      )}
      <form onSubmit={confirm}>
        <Input
          label="Authenticator code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <ErrorBanner message={error} />
        <Button variant="login" type="submit" disabled={busy || code.trim() === ''}>
          Confirm code
        </Button>
      </form>
    </div>
  );
}
