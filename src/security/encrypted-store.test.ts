import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./encrypted-store.js";

describe("Encrypted Store", () => {
  const passphrase = "test-passphrase-for-gimli-2026";

  describe("encrypt/decrypt", () => {
    it("round-trips plaintext correctly", () => {
      const plaintext = "my-secret-api-key-12345";
      const encrypted = encrypt(plaintext, passphrase);
      const decrypted = decrypt(encrypted, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it("handles empty strings", () => {
      const encrypted = encrypt("", passphrase);
      const decrypted = decrypt(encrypted, passphrase);
      expect(decrypted).toBe("");
    });

    it("handles unicode content", () => {
      const plaintext = "secret-key-\u{1F512}-\u{1F680}";
      const encrypted = encrypt(plaintext, passphrase);
      const decrypted = decrypt(encrypted, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it("handles large content", () => {
      const plaintext = "x".repeat(100_000);
      const encrypted = encrypt(plaintext, passphrase);
      const decrypted = decrypt(encrypted, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for same plaintext (unique salt/IV)", () => {
      const plaintext = "same-secret";
      const enc1 = encrypt(plaintext, passphrase);
      const enc2 = encrypt(plaintext, passphrase);
      // Encrypted outputs should differ due to random salt and IV
      expect(enc1.equals(enc2)).toBe(false);
      // But both should decrypt to the same value
      expect(decrypt(enc1, passphrase)).toBe(plaintext);
      expect(decrypt(enc2, passphrase)).toBe(plaintext);
    });

    it("fails with wrong passphrase", () => {
      const encrypted = encrypt("secret", passphrase);
      expect(() => decrypt(encrypted, "wrong-passphrase")).toThrow();
    });

    it("fails with corrupted data", () => {
      const encrypted = encrypt("secret", passphrase);
      // Corrupt a byte in the ciphertext portion
      encrypted[encrypted.length - 1] ^= 0xff;
      expect(() => decrypt(encrypted, passphrase)).toThrow();
    });

    it("fails with invalid magic bytes", () => {
      const encrypted = encrypt("secret", passphrase);
      // Corrupt magic bytes
      encrypted[0] = 0x00;
      expect(() => decrypt(encrypted, passphrase)).toThrow(/Invalid encrypted file format/);
    });
  });
});
