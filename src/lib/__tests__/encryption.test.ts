import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKeyHint } from '@/lib/encryption';

describe('encryption', () => {
  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts a simple string', () => {
      const plaintext = 'sk-ant-api03-test-key-12345';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts an empty string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('encrypts and decrypts unicode content', () => {
      const plaintext = '日本語テスト 🔑 émojis';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('encrypts and decrypts a very long key', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });
  });

  describe('encryption format', () => {
    it('produces versioned format: v1:iv:tag:cipher', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const a = encrypt('same-plaintext');
      const b = encrypt('same-plaintext');
      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe(decrypt(b));
    });
  });

  describe('tamper detection', () => {
    it('throws on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      const tampered = parts.slice(0, 3).join(':') + ':' +
        Buffer.from('tampered-data').toString('base64');
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      const fakeTag = Buffer.alloc(16, 0xff).toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${fakeTag}:${parts[3]}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on invalid format', () => {
      expect(() => decrypt('not-a-valid-encrypted-string')).toThrow();
    });
  });

  describe('generateKeyHint', () => {
    it('returns first 7 + last 4 characters for long keys', () => {
      const hint = generateKeyHint('sk-ant-api03-abcdef-12345-xyz');
      expect(hint).toBe('sk-ant-...-xyz');
    });

    it('returns *** for very short keys', () => {
      expect(generateKeyHint('short')).toBe('***');
    });

    it('returns *** for keys at boundary length (11 chars)', () => {
      expect(generateKeyHint('12345678901')).toBe('***');
    });

    it('shows hint for 12+ character keys', () => {
      const hint = generateKeyHint('123456789012');
      expect(hint).toBe('1234567...9012');
    });
  });
});
