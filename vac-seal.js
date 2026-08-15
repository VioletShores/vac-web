/**
 * vac-seal.js — F-1136 Living-Seal client-side WebCrypto module
 *
 * Zero-server-plaintext: secrets are encrypted IN THE BROWSER using the
 * tenant's RSA-OAEP vault public key before they leave the device.
 * The server stores ciphertext only — it cannot read the secret in transit.
 *
 * Algorithm: RSA-OAEP with SHA-256 (matches Python VaultRSA on the server).
 * Key storage: IndexedDB (not localStorage — survives page reload, not exportable
 * via XSS unlike localStorage raw strings, and handles ArrayBuffer correctly).
 *
 * Three-layer trust chain:
 *   VAC identity → RLS row isolation → F-1136 seal → receipt
 *
 * Usage:
 *   const sealer = new VacSealer({ tenantId, apiBase, authToken });
 *   await sealer.init();                     // load or fetch public key
 *   const { sealedEnvelope, receipt } = await sealer.seal(plaintext, { providerId });
 */

'use strict';

const VAC_SEAL_IDB_NAME  = 'vac-vault-keys';
const VAC_SEAL_IDB_STORE = 'pubkeys';
const VAC_SEAL_IDB_VER   = 1;

const RSA_ALGORITHM = {
  name: 'RSA-OAEP',
  hash: { name: 'SHA-256' },
};

const RSA_GEN_PARAMS = {
  ...RSA_ALGORITHM,
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAC_SEAL_IDB_NAME, VAC_SEAL_IDB_VER);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(VAC_SEAL_IDB_STORE);
    };
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
  });
}

async function _idbGet(key) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(VAC_SEAL_IDB_STORE, 'readonly');
    const req = tx.objectStore(VAC_SEAL_IDB_STORE).get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function _idbPut(key, value) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(VAC_SEAL_IDB_STORE, 'readwrite');
    const req = tx.objectStore(VAC_SEAL_IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Base64 helpers ─────────────────────────────────────────────────────────

function _ab2b64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary  = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function _b642ab(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * VacSealer — stateful sealing session for one tenant.
 *
 * @param {object} opts
 * @param {string} opts.tenantId   — tenant identifier (matches backend vault)
 * @param {string} opts.apiBase    — e.g. "https://api.athenapilot.ai"
 * @param {string} opts.authToken  — MAC_RELAY_SECRET or hub bearer token
 */
class VacSealer {
  constructor({ tenantId, apiBase, authToken }) {
    if (!tenantId) throw new Error('VacSealer: tenantId required');
    this.tenantId  = tenantId;
    this.apiBase   = (apiBase || '').replace(/\/$/, '');
    this.authToken = authToken || '';
    this._pubKey   = null; // CryptoKey — loaded by init()
    this._spkiB64  = null; // raw SPKI for display / server verification
  }

  /**
   * Load the vault public key.
   * Order: IndexedDB cache → server fetch + cache.
   * Emits 'vac-seal:key-ready' on window when the key is available.
   */
  async init() {
    const cacheKey = `spki:${this.tenantId}`;
    const cached   = await _idbGet(cacheKey);
    if (cached) {
      this._spkiB64 = cached;
      this._pubKey  = await this._importSpki(cached);
      window.dispatchEvent(new CustomEvent('vac-seal:key-ready', {
        detail: { tenantId: this.tenantId, source: 'cache' },
      }));
      return this;
    }

    // Fetch from server
    const res = await fetch(`${this.apiBase}/v1/vault/keypair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ tenant_id: this.tenantId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`VacSealer: keypair fetch failed — ${err.detail || res.status}`);
    }
    const data    = await res.json();
    const spkiB64 = data.public_key_spki;
    if (!spkiB64) throw new Error('VacSealer: server returned no public_key_spki');

    this._spkiB64 = spkiB64;
    this._pubKey  = await this._importSpki(spkiB64);
    await _idbPut(cacheKey, spkiB64);

    window.dispatchEvent(new CustomEvent('vac-seal:key-ready', {
      detail: { tenantId: this.tenantId, source: 'server' },
    }));
    return this;
  }

  /**
   * Seal a plaintext secret and POST the ciphertext to the server.
   * Plaintext NEVER leaves the browser — only ciphertext is sent.
   *
   * @param {string} plaintext   — the secret to seal (e.g. an API key)
   * @param {object} opts
   * @param {string} opts.providerId      — vault provider identifier
   * @param {string} [opts.scope]         — 'execute' | 'select'
   * @param {string} [opts.sealTier]      — 'machine' | 'human' | 'crown_jewel'
   * @param {string} [opts.credentialLabel]
   * @param {number} [opts.expiryDays]
   * @param {function} [opts.onProgress]  — called with progress messages
   * @returns {{ sealedEnvelope, receipt }} — ciphertext b64 + server receipt ref
   */
  async seal(plaintext, {
    providerId,
    scope          = 'execute',
    sealTier       = 'machine',
    credentialLabel,
    expiryDays,
    onProgress     = () => {},
  } = {}) {
    if (!this._pubKey) throw new Error('VacSealer: call init() before seal()');
    if (!providerId)   throw new Error('VacSealer: providerId required');
    if (!plaintext)    throw new Error('VacSealer: plaintext must be non-empty');

    onProgress('Encrypting secret in browser...');

    const enc           = new TextEncoder();
    const plaintextBuf  = enc.encode(plaintext);
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      this._pubKey,
      plaintextBuf,
    );
    const sealedEnvelope = _ab2b64(ciphertextBuf);

    onProgress('Ciphertext ready — sending sealed envelope to server (no plaintext in transit)...');

    const payload = {
      tenant_id:        this.tenantId,
      provider_id:      providerId,
      sealed_envelope:  sealedEnvelope,
      scope,
      seal_tier:        sealTier,
      credential_label: credentialLabel,
      expiry_days:      expiryDays,
    };

    const res = await fetch(`${this.apiBase}/v1/vault/store-sealed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`VacSealer: store-sealed failed — ${err.detail || res.status}`);
    }

    const ref = await res.json();
    onProgress('Seal complete. Attestation receipt issued by server.');

    return {
      sealedEnvelope, // ciphertext (b64) — can be shown to user as proof
      receipt: ref,   // server metadata + seal_receipt_id
    };
  }

  /** Return the raw SPKI b64 for display or server verification. */
  get publicKeySpki() {
    return this._spkiB64;
  }

  // ── private ───────────────────────────────────────────────────────────────

  async _importSpki(spkiB64) {
    const keyData = _b642ab(spkiB64);
    return crypto.subtle.importKey(
      'spki',
      keyData,
      RSA_ALGORITHM,
      false, // not extractable — stays in browser memory only
      ['encrypt'],
    );
  }
}

/**
 * Standalone seal helper — no class required.
 * Seals a plaintext string with a pre-loaded CryptoKey or SPKI b64.
 */
async function vacSealWithKey(plaintext, publicKeyOrSpki) {
  let pubKey = publicKeyOrSpki;
  if (typeof publicKeyOrSpki === 'string') {
    pubKey = await crypto.subtle.importKey(
      'spki',
      _b642ab(publicKeyOrSpki),
      RSA_ALGORITHM,
      false,
      ['encrypt'],
    );
  }
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, enc.encode(plaintext));
  return _ab2b64(ct);
}

// Export for module environments (vite/webpack) and browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VacSealer, vacSealWithKey, _ab2b64, _b642ab };
} else {
  window.VacSealer    = VacSealer;
  window.vacSealWithKey = vacSealWithKey;
}
