/**
 * AES-256-GCM encrypted storage for Gimli secrets.
 *
 * Replaces the plaintext Memory Vault with encrypted-at-rest storage.
 * Uses PBKDF2 key derivation from a user passphrase and AES-256-GCM
 * for authenticated encryption.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation for SHA-256
const PBKDF2_DIGEST = "sha256";
const FILE_MAGIC = Buffer.from("GIMLI_ENC_V1"); // File format version marker

export interface EncryptedStoreOptions {
  /** Directory to store encrypted files */
  storeDir: string;
  /** Passphrase for key derivation. If not provided, uses GIMLI_STORE_KEY env var */
  passphrase?: string;
}

/**
 * Derives an AES-256 key from a passphrase using PBKDF2.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt plaintext data with AES-256-GCM.
 * Returns: MAGIC(12) + SALT(32) + IV(12) + TAG(16) + CIPHERTEXT(...)
 */
export function encrypt(plaintext: string, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([FILE_MAGIC, salt, iv, tag, encrypted]);
}

/**
 * Decrypt AES-256-GCM encrypted data.
 */
export function decrypt(data: Buffer, passphrase: string): string {
  const magicLen = FILE_MAGIC.length;

  // Verify magic bytes
  const magic = data.subarray(0, magicLen);
  if (!timingSafeEqual(magic, FILE_MAGIC)) {
    throw new Error("Invalid encrypted file format or corrupted data");
  }

  let offset = magicLen;
  const salt = data.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = data.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = data.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypted key-value store for Gimli secrets.
 */
export class EncryptedStore {
  private storeDir: string;
  private passphrase: string;

  constructor(options: EncryptedStoreOptions) {
    this.storeDir = options.storeDir;
    this.passphrase = options.passphrase ?? process.env.GIMLI_STORE_KEY ?? "";

    if (!this.passphrase) {
      throw new Error(
        "Encrypted store requires a passphrase. Set GIMLI_STORE_KEY environment variable " +
          "or pass passphrase in options.",
      );
    }

    // Ensure store directory exists with restrictive permissions
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Store a secret value under a key name.
   */
  set(key: string, value: string): void {
    this.validateKey(key);
    const filePath = this.keyToPath(key);
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const encrypted = encrypt(value, this.passphrase);
    writeFileSync(filePath, encrypted, { mode: 0o600 });
  }

  /**
   * Retrieve a secret value by key name.
   * Returns null if the key doesn't exist.
   */
  get(key: string): string | null {
    this.validateKey(key);
    const filePath = this.keyToPath(key);
    if (!existsSync(filePath)) {
      return null;
    }
    const data = readFileSync(filePath);
    return decrypt(data, this.passphrase);
  }

  /**
   * Delete a secret.
   */
  delete(key: string): boolean {
    this.validateKey(key);
    const filePath = this.keyToPath(key);
    if (!existsSync(filePath)) {
      return false;
    }
    // Overwrite with random data before unlinking (defense in depth)
    const size = readFileSync(filePath).length;
    writeFileSync(filePath, randomBytes(size), { mode: 0o600 });
    const { unlinkSync } = require("node:fs");
    unlinkSync(filePath);
    return true;
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    this.validateKey(key);
    return existsSync(this.keyToPath(key));
  }

  /**
   * Validate key name to prevent path traversal.
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== "string") {
      throw new Error("Key must be a non-empty string");
    }
    if (key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) {
      throw new Error("Key contains invalid characters (path traversal attempt blocked)");
    }
    if (key.length > 255) {
      throw new Error("Key exceeds maximum length of 255 characters");
    }
  }

  private keyToPath(key: string): string {
    return join(this.storeDir, `${key}.enc`);
  }
}
