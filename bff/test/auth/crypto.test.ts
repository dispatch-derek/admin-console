// auth/crypto.ts — argon2id password hashing, recovery-code hashing, and AES-256-GCM
// secret-at-rest encryption (REQ-015, REQ-019, REQ-094). Pure crypto module (no db import)
// so ordinary static imports are safe; config.ts's SECRETS_ENC_KEY comes from test/setup.ts.

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  normalizeRecoveryCode,
  hashRecoveryCode,
  encryptSecret,
  decryptSecret,
} from '../../src/auth/crypto.js';

describe('hashPassword / verifyPassword (argon2id, REQ-015)', () => {
  it('produces an argon2id hash that is not the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies true for the correct password', async () => {
    const hash = await hashPassword('s3cr3t-passphrase');
    await expect(verifyPassword(hash, 's3cr3t-passphrase')).resolves.toBe(true);
  });

  it('verifies false for an incorrect password', async () => {
    const hash = await hashPassword('s3cr3t-passphrase');
    await expect(verifyPassword(hash, 'wrong-passphrase')).resolves.toBe(false);
  });

  it('verifies false (never throws) against a malformed/legacy hash', async () => {
    await expect(verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });

  it('two hashes of the same password differ (random salt per call)', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
  });
});

describe('verifyDummyPassword (timing equalization, sec review M-2)', () => {
  it('always resolves to false and never throws, regardless of input', async () => {
    await expect(verifyDummyPassword('anything')).resolves.toBe(false);
    await expect(verifyDummyPassword('')).resolves.toBe(false);
    await expect(verifyDummyPassword('!@#$ unicode 你好')).resolves.toBe(false);
  });
});

describe('normalizeRecoveryCode', () => {
  it('lowercases, trims, and strips non-alphanumeric characters', () => {
    expect(normalizeRecoveryCode('  ABC-DE 123  ')).toBe('abcde123');
  });

  it('leaves an already-normalized code unchanged', () => {
    expect(normalizeRecoveryCode('abcde123')).toBe('abcde123');
  });
});

describe('hashRecoveryCode (sha256, single-use lookup)', () => {
  it('is stable for the same code across calls', () => {
    expect(hashRecoveryCode('abcde12345')).toBe(hashRecoveryCode('abcde12345'));
  });

  it('produces the same hash for stray formatting variants of the same code', () => {
    expect(hashRecoveryCode('ABCDE-12345')).toBe(hashRecoveryCode('abcde12345'));
  });

  it('produces a different hash for a different code (verify rejects a wrong code)', () => {
    expect(hashRecoveryCode('abcde12345')).not.toBe(hashRecoveryCode('fghij67890'));
  });
});

describe('encryptSecret / decryptSecret (AES-256-GCM, REQ-094)', () => {
  it('round-trips a TOTP secret exactly', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('the ciphertext is never equal to the plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(encryptSecret(secret)).not.toBe(secret);
  });

  it('encrypting the same plaintext twice yields different ciphertext (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b);
    // Both must still decrypt correctly despite differing ciphertext/IV.
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it('a tampered ciphertext fails to decrypt (GCM auth-tag check)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret);
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte inside the ciphertext region (after the 12-byte IV + 16-byte tag).
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('a tampered auth tag fails to decrypt', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(secret);
    const buf = Buffer.from(encrypted, 'base64');
    // Byte 12 is inside the 16-byte auth tag (iv is bytes 0..11).
    buf[12] = buf[12]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
