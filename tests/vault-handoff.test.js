// vault-handoff.test.js — vac-vault-handoff.js (athena PKT-S204-VAULT-MOBILE-HANDOFF).
//
// Runs the shipped module in a vm sandbox with a stub window/document/fetch,
// and asserts: inert without params; only a SERVER-authenticated full result
// with an opener mints; delivery is a postMessage pinned to the allow-listed
// Vault origin; the ack is origin-, source- and state-checked; it never
// navigates. The cross-browser run is athena's Playwright e2e.
//
// Run: node --test tests/vault-handoff.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const VAULT = 'https://api.athenapilot.ai';
const STATE = 'S'.repeat(43);
const JWT = 'aaa.bbb.ccc';

function el() {
  return { style: {}, attrs: {}, children: [], textContent: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; } };
}

function load(search, { opener = 'present', authFetch } = {}) {
  const posted = [];
  const fetches = [];
  const listeners = {};
  const byId = {};
  let closed = false;
  const navigations = [];
  const op = opener === 'present' ? { closed: false, postMessage: (m, o) => posted.push({ m, o }) } : null;
  const document = {
    body: el(),
    createElement() { return el(); },
    getElementById(id) { return byId[id] || null; },
  };
  document.body.appendChild = (c) => { const walk = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(walk); }; walk(c); return c; };
  const location = {};
  Object.defineProperty(location, 'search', { get: () => search });
  for (const k of ['href', 'hash']) Object.defineProperty(location, k, { get: () => '', set: (v) => navigations.push(v) });
  const window = {
    location, opener: op, closed: false,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    close() { closed = true; },
  };
  const fetch = (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) });
    const r = authFetch ? authFetch(url, init) : { ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp: Date.now() / 1000 + 120 } } };
    return Promise.resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) });
  };
  const timers = [];
  const ctx = { window, document, fetch, URLSearchParams, Promise, JSON, Date, String, Object, Error,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
    history: { pushState: (...a) => navigations.push(a), replaceState: (...a) => navigations.push(a) } };
  ctx.window.window = ctx.window;
  vm.runInNewContext(SRC, Object.assign(ctx, { self: window }));
  return { window, posted, fetches, listeners, byId, op, timers, navigations, get closed() { return closed; } };
}

const FULL = { authenticated: true, session_token: 'sess.sig', session: { auth_level: 'full', email: 'Owner@Example.invalid', token: 'sess.sig' } };
const flush = () => new Promise((r) => setImmediate(r));

test('without handoff params the module defines nothing and listens to nothing', () => {
  for (const search of ['', '?return=/tribunal-demo', '?state=' + STATE]) {
    const h = load(search);
    assert.equal(h.window.VACVaultHandoff, undefined);
    assert.deepEqual(h.listeners, {});
    assert.equal(h.fetches.length, 0);
  }
});

test('a full server verdict with an opener mints a handoff VAT and posts it to the pinned Vault origin', async () => {
  const h = load('?handoff=vault-store&state=' + STATE + '&origin=https://evil.example');
  h.window.VACVaultHandoff.onVerified(FULL, { email: 'x@y' });
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.match(h.fetches[0].url, /\/v1\/vat\/issue$/);
  assert.deepEqual(h.fetches[0].body.handoff, { audience: 'athena:vault:store', nonce: STATE });
  assert.equal(h.fetches[0].body.authorising_session_token, 'sess.sig');
  assert.equal(h.fetches[0].body.human_identity, 'email:owner@example.invalid');
  assert.ok(h.fetches[0].body.expiry_seconds <= 120);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].o, VAULT, 'targetOrigin must be the pinned Vault origin, never * or the URL');
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0].m)), { type: 'vac-vault-handoff', state: STATE, assertion: JWT });
  assert.equal(h.navigations.length, 0, 'the handoff never navigates');
});

test('a failed or partial ceremony delivers nothing', async () => {
  for (const r of [{ authenticated: false, session_token: 's', session: { auth_level: 'full' } }, null, {}]) {
    const h = load('?handoff=vault-store&state=' + STATE);
    h.window.VACVaultHandoff.onVerified(r, { email: 'a@b' });
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('below full is not handed off', async () => {
  for (const level of ['quick', 'otp', undefined]) {
    const h = load('?handoff=vault-store&state=' + STATE);
    h.window.VACVaultHandoff.onVerified({ authenticated: true, session_token: 's', session: { auth_level: level, email: 'a@b' } }, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('no opener: nothing is minted or sent, and the page says to return to the Vault tab', async () => {
  const h = load('?handoff=vault-store&state=' + STATE, { opener: null });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush();
  assert.equal(h.fetches.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /Return to the Vault tab/);
});

test('an unknown target or a malformed state sends nothing', async () => {
  for (const search of ['?handoff=evil&state=' + STATE, '?handoff=vault-store&state=short', '?handoff=vault-store']) {
    const h = load(search);
    h.window.VACVaultHandoff.onVerified(FULL, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('the ack is accepted only from the Vault origin, from the opener, for this state', async () => {
  const h = load('?handoff=vault-store&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  const [onMsg] = h.listeners.message;
  const ack = { type: 'vac-vault-handoff-ack', state: STATE };
  onMsg({ origin: 'https://evil.example', source: h.op, data: ack });
  onMsg({ origin: VAULT, source: {}, data: ack });
  onMsg({ origin: VAULT, source: h.op, data: { type: 'vac-vault-handoff-ack', state: 'T'.repeat(43) } });
  h.timers.forEach((t) => t.ms === 1200 && t.f());
  assert.equal(h.closed, false);
  assert.notEqual(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  onMsg({ origin: VAULT, source: h.op, data: ack });
  assert.equal(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  h.timers.filter((t) => t.ms === 1200).forEach((t) => t.f());
  assert.equal(h.closed, true);
});

test('send again re-posts the same assertion while it is fresh, and re-mints once it is not', async () => {
  let exp = Date.now() / 1000 + 120;
  const h = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp } } }) });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h.byId.vacVaultHandoffResend.listeners.click();
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.posted.length, 2);
  exp = Date.now() / 1000 - 1;
  const h2 = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp } } }) });
  h2.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h2.byId.vacVaultHandoffResend.listeners.click();
  await flush(); await flush();
  assert.equal(h2.fetches.length, 2);
});

test('a VAC refusal sends nothing and says so', async () => {
  const h = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: false, status: 403, body: { detail: { error: 'handoff_biometric_stale', message: 'too old' } } }) });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  assert.equal(h.posted.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /too old/);
});

test('the module source never writes the assertion to a URL, storage or the console', () => {
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|console\.|location\.(href|hash|assign|replace)\s*=|history\./);
  assert.doesNotMatch(SRC, /postMessage\([^)]*['"]\*['"]/);
});
