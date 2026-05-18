/**
 * AES-256-GCM encryption for per-instructor API keys.
 *
 * Ciphertext layout (stored in instructor_api_keys.api_key_encrypted):
 *   [ IV (12 bytes) | AUTH_TAG (16 bytes) | CIPHERTEXT (variable) ]
 *
 * Master key: MTC_KEY_ENCRYPTION_SECRET in .env.local
 *   - Required to be 32 raw bytes encoded as base64 (44 chars including padding)
 *   - Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Loss of MTC_KEY_ENCRYPTION_SECRET renders every stored key unrecoverable;
 * rotation requires re-entering each key after switching the secret.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey = null;

function getMasterKey() {
  if (cachedKey) return cachedKey;
  const b64 = process.env.MTC_KEY_ENCRYPTION_SECRET;
  if (!b64) {
    throw new Error(
      'MTC_KEY_ENCRYPTION_SECRET is not set. Generate one with: ' +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `MTC_KEY_ENCRYPTION_SECRET must decode to exactly 32 bytes (got ${buf.length}). ` +
      'Generate a fresh one and re-enter all stored keys.'
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypt a plaintext API key.
 * @param {string} plaintext - The API key in plaintext
 * @returns {Buffer} IV || TAG || CIPHERTEXT
 */
export function encryptKey(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptKey: plaintext must be a non-empty string');
  }
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypt a previously-encrypted API key.
 * @param {Buffer} blob - Output of encryptKey()
 * @returns {string} Plaintext API key
 */
export function decryptKey(blob) {
  if (!Buffer.isBuffer(blob) || blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decryptKey: invalid ciphertext blob');
  }
  const key = getMasterKey();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

/**
 * Last-4-character hint stored alongside the encrypted key.
 * Helps instructors identify which key is which in the UI without revealing
 * the secret.
 */
export function keyHint(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return '';
  return plaintext.slice(-4);
}
