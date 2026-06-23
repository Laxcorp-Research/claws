import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  generateKeyHint,
  decryptWithMigration,
  decryptAndMaybeReencrypt,
  assessDecryptHealth,
} from '@/lib/encryption';

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
      const plaintext = '-????? ?? mojis';
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

// ??? Key-rotation guardrail (old-key fallback, re-encrypt-on-read, health) ???

const KA = 'a'.repeat(64); // 32-byte hex
const KB = 'b'.repeat(64);
const KC = 'c'.repeat(64); // stray key, never configured

function setEnv(key: string, val: string | undefined) {
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
}

// Encrypt under a specific master key, isolated from the runtime env.
function encryptUnder(masterHex: string, plaintext: string): string {
  const s = {
    M: process.env.ENCRYPTION_MASTER_KEY,
    P: process.env.ENCRYPTION_MASTER_KEY_PREVIOUS,
    V: process.env.ENCRYPTION_KEY_VERSION,
  };
  setEnv('ENCRYPTION_MASTER_KEY', masterHex);
  setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
  setEnv('ENCRYPTION_KEY_VERSION', undefined); // default v1
  try {
    return encrypt(plaintext);
  } finally {
    setEnv('ENCRYPTION_MASTER_KEY', s.M);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', s.P);
    setEnv('ENCRYPTION_KEY_VERSION', s.V);
  }
}

describe('encryption key-rotation guardrail', () => {
  let saved: { M?: string; P?: string; V?: string };
  beforeEach(() => {
    saved = {
      M: process.env.ENCRYPTION_MASTER_KEY,
      P: process.env.ENCRYPTION_MASTER_KEY_PREVIOUS,
      V: process.env.ENCRYPTION_KEY_VERSION,
    };
  });
  afterEach(() => {
    setEnv('ENCRYPTION_MASTER_KEY', saved.M);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', saved.P);
    setEnv('ENCRYPTION_KEY_VERSION', saved.V);
  });

  // No-regression: existing ciphertext must keep decrypting unchanged.
  it('round-trips current-key ciphertext with no previous key set (unchanged behavior)', () => {
    setEnv('ENCRYPTION_MASTER_KEY', KA);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
    const blob = encrypt('super-secret');
    expect(decrypt(blob)).toBe('super-secret');
  });

  it('still decrypts legacy 3-part (no version prefix) ciphertext as v1', () => {
    setEnv('ENCRYPTION_MASTER_KEY', KA);
    const fourPart = encrypt('legacy-value');
    const legacy = fourPart.split(':').slice(1).join(':'); // iv:tag:ct
    expect(legacy.split(':')).toHaveLength(3);
    expect(decrypt(legacy)).toBe('legacy-value');
  });

  // 1) Old-key fallback (decrypt-with-either).
  it('decrypts a PREVIOUS-key blob when ENCRYPTION_MASTER_KEY_PREVIOUS is set', () => {
    const blobUnderOld = encryptUnder(KA, 'rotated-secret');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    expect(decrypt(blobUnderOld)).toBe('rotated-secret');
  });

  it('MUTATION GUARD: without the previous-key fallback, a PREVIOUS-key blob fails to decrypt', () => {
    const blobUnderOld = encryptUnder(KA, 'rotated-secret');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
    expect(() => decrypt(blobUnderOld)).toThrow();
  });

  it('a CURRENT-key blob still decrypts when a previous key is also configured (no regression)', () => {
    const blobUnderCurrent = encryptUnder(KB, 'current-secret');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    expect(decrypt(blobUnderCurrent)).toBe('current-secret');
  });

  // 2) Re-encrypt-on-read migration.
  it('decryptWithMigration: PREVIOUS-key value yields a re-encrypted CURRENT-key blob', () => {
    const blobUnderOld = encryptUnder(KA, 'migrate-me');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    const { plaintext, reencrypted } = decryptWithMigration(blobUnderOld);
    expect(plaintext).toBe('migrate-me');
    expect(reencrypted).not.toBeNull();
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
    expect(decrypt(reencrypted as string)).toBe('migrate-me'); // decrypts under current alone
  });

  it('decryptWithMigration: CURRENT-key value needs no migration (reencrypted = null)', () => {
    const blobUnderCurrent = encryptUnder(KB, 'already-current');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    const { plaintext, reencrypted } = decryptWithMigration(blobUnderCurrent);
    expect(plaintext).toBe('already-current');
    expect(reencrypted).toBeNull();
  });

  it('decryptAndMaybeReencrypt: persists a current-key blob after reading a previous-key value', async () => {
    const blobUnderOld = encryptUnder(KA, 'read-then-migrate');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    const persisted: string[] = [];
    const plaintext = await decryptAndMaybeReencrypt(blobUnderOld, async (nb) => {
      persisted.push(nb);
    });
    expect(plaintext).toBe('read-then-migrate');
    expect(persisted).toHaveLength(1); // MUTATION: skip re-encrypt ? length 0 ? fails
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
    expect(decrypt(persisted[0])).toBe('read-then-migrate');
  });

  it('decryptAndMaybeReencrypt: a persist (write) failure still returns the decrypted value', async () => {
    const blobUnderOld = encryptUnder(KA, 'value-survives-write-fail');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    const plaintext = await decryptAndMaybeReencrypt(blobUnderOld, async () => {
      throw new Error('db write failed');
    });
    expect(plaintext).toBe('value-survives-write-fail');
  });

  it('decryptAndMaybeReencrypt: a CURRENT-key value does not trigger a persist', async () => {
    const blobUnderCurrent = encryptUnder(KB, 'no-migration');
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', KA);
    let persistCalled = false;
    const plaintext = await decryptAndMaybeReencrypt(blobUnderCurrent, async () => {
      persistCalled = true;
    });
    expect(plaintext).toBe('no-migration');
    expect(persistCalled).toBe(false);
  });

  // 3) Decrypt-health probe (pass/fail only).
  it('assessDecryptHealth: all-good ? ok; an undecryptable blob ? not ok', () => {
    setEnv('ENCRYPTION_MASTER_KEY', KB);
    setEnv('ENCRYPTION_MASTER_KEY_PREVIOUS', undefined);
    const good = encryptUnder(KB, 'g');
    const bad = encryptUnder(KC, 'x'); // stray key, never configured
    expect(assessDecryptHealth([good]).ok).toBe(true);
    const mixed = assessDecryptHealth([good, bad]);
    expect(mixed.ok).toBe(false);
    expect(mixed.failed).toBe(1);
    expect(mixed.checked).toBe(2);
  });
});
