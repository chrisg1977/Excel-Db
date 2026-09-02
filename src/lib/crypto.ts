import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-level encryption for secrets stored at rest (OAuth refresh tokens etc).
 *
 * No app-level secrets-encryption pattern existed elsewhere in this repo
 * before this feature (Directus's own KEY/SECRET only sign its cookies/JWTs,
 * they don't encrypt arbitrary fields) — this introduces one, keyed by the
 * EMAIL_ACCOUNTS_ENCRYPTION_KEY env var, for reuse by future features that
 * need to store a credential at rest.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.EMAIL_ACCOUNTS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'EMAIL_ACCOUNTS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it as an env var.'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('EMAIL_ACCOUNTS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
  }
  return key;
}

/** Encrypts a plaintext secret. Returns `iv:authTag:ciphertext`, all base64. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Decrypts a value produced by encryptSecret(). Throws if the key or payload is wrong/tampered. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
