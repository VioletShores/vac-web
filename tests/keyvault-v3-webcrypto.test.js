/**
 * F-538 WebCrypto round-trip test for keyvault-v3
 * Run: node tests/keyvault-v3-webcrypto.test.js
 *
 * Tests:
 *   1. AES-256-GCM encrypt/decrypt round-trip (same PIN+email → same key)
 *   2. Wrong PIN produces decryption failure (not wrong plaintext)
 *   3. Wrong email produces decryption failure
 *   4. PBKDF2 + HKDF key derivation is deterministic
 *   5. No plaintext seed appears in any simulated fetch body (static check)
 */

const { webcrypto } = require('crypto');
const crypto = webcrypto;

// ── Key derivation (mirrors keyvault-v3.html) ──────────────────────────────
const PBKDF2_ITERATIONS = 250000;
const INFO_BYTES = new TextEncoder().encode('vac-vault-seed-v1');

async function deriveKey(pin, emailStr, salt) {
  const pinBytes = new TextEncoder().encode(pin);
  const emailBytes = new TextEncoder().encode(emailStr);

  const pbkdfMaterial = await crypto.subtle.importKey(
    'raw', pinBytes, 'PBKDF2', false, ['deriveBits']
  );
  const pinDerived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    pbkdfMaterial, 256
  );

  const combinedIkm = new Uint8Array(pinDerived.byteLength + emailBytes.byteLength);
  combinedIkm.set(new Uint8Array(pinDerived), 0);
  combinedIkm.set(emailBytes, pinDerived.byteLength);

  const hkdfMaterial = await crypto.subtle.importKey(
    'raw', combinedIkm, 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO_BYTES },
    hkdfMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSeed(words, pin, email) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, email, salt);
  const plaintext = new TextEncoder().encode(words.join(' '));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { ciphertext: new Uint8Array(ciphertext), iv, salt };
}

async function decryptSeed(ciphertext, iv, salt, pin, email) {
  const key = await deriveKey(pin, email, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── Test runner ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  PASS', name);
    passed++;
  } catch (err) {
    console.error('  FAIL', name, '—', err.message || err);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ── Tests ─────────────────────────────────────────────────────────────────
const SEED_12 = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SEED_24 = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual';
const PIN = 'test-vault-pin-42';
const EMAIL = 'robzag@gmail.com';

console.log('F-538 WebCrypto round-trip tests (keyvault-v3)\n');

(async () => {
  await test('round-trip: 12-word seed encrypts and decrypts correctly', async () => {
    const { ciphertext, iv, salt } = await encryptSeed(SEED_12.split(' '), PIN, EMAIL);
    const decrypted = await decryptSeed(ciphertext, iv, salt, PIN, EMAIL);
    assert(decrypted === SEED_12, 'decrypted seed must match original');
  });

  await test('round-trip: 24-word seed encrypts and decrypts correctly', async () => {
    const { ciphertext, iv, salt } = await encryptSeed(SEED_24.split(' '), PIN, EMAIL);
    const decrypted = await decryptSeed(ciphertext, iv, salt, PIN, EMAIL);
    assert(decrypted === SEED_24, 'decrypted seed must match original');
  });

  await test('wrong PIN fails decryption (AES-GCM tag mismatch)', async () => {
    const { ciphertext, iv, salt } = await encryptSeed(SEED_12.split(' '), PIN, EMAIL);
    let threw = false;
    try {
      await decryptSeed(ciphertext, iv, salt, 'wrong-pin', EMAIL);
    } catch (_) { threw = true; }
    assert(threw, 'decryption with wrong PIN must throw');
  });

  await test('wrong email fails decryption (ceremony binding)', async () => {
    const { ciphertext, iv, salt } = await encryptSeed(SEED_12.split(' '), PIN, EMAIL);
    let threw = false;
    try {
      await decryptSeed(ciphertext, iv, salt, PIN, 'attacker@evil.com');
    } catch (_) { threw = true; }
    assert(threw, 'decryption with wrong email must throw');
  });

  await test('key derivation is deterministic (same inputs → same key)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await deriveKey(PIN, EMAIL, salt);
    const k2 = await deriveKey(PIN, EMAIL, salt);
    // Encrypt with k1, decrypt with k2 — if same, roundtrip succeeds
    const iv = new Uint8Array(12);
    const pt = new TextEncoder().encode('determinism-check');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, pt);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct);
    assert(new TextDecoder().decode(dec) === 'determinism-check', 'keys must be identical for same inputs');
  });

  await test('different salts produce different keys (salt isolation)', async () => {
    const salt1 = crypto.getRandomValues(new Uint8Array(32));
    const salt2 = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await deriveKey(PIN, EMAIL, salt1);
    const k2 = await deriveKey(PIN, EMAIL, salt2);
    const iv = new Uint8Array(12);
    const pt = new TextEncoder().encode('salt-isolation-check');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, pt);
    let threw = false;
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct);
    } catch (_) { threw = true; }
    assert(threw, 'different salts must produce different keys');
  });

  await test('ciphertext does not contain plaintext seed (no plaintext leakage)', async () => {
    const { ciphertext } = await encryptSeed(SEED_12.split(' '), PIN, EMAIL);
    const ctStr = Buffer.from(ciphertext).toString('utf8');
    // Each word from the seed must not appear as a UTF-8 substring of the ciphertext
    const words = SEED_12.split(' ');
    for (const word of words) {
      assert(!ctStr.includes(word), 'seed word "' + word + '" must not appear in ciphertext');
    }
  });

  await test('network-call static check: no plaintext seed in simulated fetch body', async () => {
    // Simulate what keyvault-v3 stores/sends: only {salt, iv, ct} as base64
    const { ciphertext, iv, salt } = await encryptSeed(SEED_12.split(' '), PIN, EMAIL);
    const toB64 = buf => Buffer.from(buf).toString('base64');
    const body = JSON.stringify({
      vault_salt: toB64(salt),
      iv: toB64(iv),
      ct: toB64(ciphertext),
    });
    // The full seed must not appear as a substring
    assert(!body.includes(SEED_12), 'plaintext seed must not appear in simulated network body');
    // No individual word (≥4 chars) should appear either
    for (const word of SEED_12.split(' ').filter(w => w.length >= 4)) {
      assert(!body.includes(word), 'seed word "' + word + '" must not appear in network body');
    }
  });

  console.log('\nResult:', passed, 'passed,', failed, 'failed');
  process.exit(failed > 0 ? 1 : 0);
})();
