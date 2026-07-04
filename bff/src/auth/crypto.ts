// Auth crypto primitives (REQ-015, REQ-019, REQ-094). Passwords → argon2id hashes;
// recovery codes → sha256 (single-use, high-entropy, lookup-by-hash); TOTP secrets →
// AES-256-GCM encrypt/decrypt at rest with a key derived from SECRETS_ENC_KEY. Plaintext
// passwords, recovery codes and TOTP secrets are NEVER stored or logged.

import argon2 from 'argon2';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

// --- Passwords (argon2id) ---

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed/legacy hash must never throw its way to the browser — treat as no match.
    return false;
  }
}

// --- Recovery codes (sha256; single-use, looked up by hash) ---

// Normalize operator input so a code entered with stray spacing/casing/dashes still
// matches the stored hash (codes are generated as lowercase hex).
export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// --- Secrets at rest (AES-256-GCM) ---

// 32-byte key derived from the configured passphrase via sha256 (REQ-094).
const encKey = createHash('sha256').update(config.secretsKey).digest();

// Returns base64 of iv(12) | authTag(16) | ciphertext.
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
