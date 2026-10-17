'use strict';
// s199-trust-status-own-session.test.js — PKT-S199-VAC-TRUST-STATUS-AUTH (vac-protocol)
//
// The VAC server now answers GET /v1/auth/trust-status only for the signed-in caller
// (their session, sent as Authorization: Bearer by _api) and refuses another address.
// vac-auth.js must (1) never put an email in that URL, (2) call it only through
// _trustStatus(), which goes through _api (so the Bearer is sent) and does not call
// at all without a stored session, and (3) never read pending_requests (removed).
//
// Run: node --test tests/s199-trust-status-own-session.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'vac-auth.js'), 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in vac-auth.js');
  let depth = 0, i = start;
  while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
  while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
  return src.slice(start, i);
}

test('no trust-status URL carries an email (or any query)', () => {
  const urls = [...src.matchAll(/['"`]\/v1\/auth\/trust-status[^'"`]*['"`]/g)].map(m => m[0]);
  assert.ok(urls.length >= 1, 'trust-status is still called');
  for (const u of urls) assert.equal(u.slice(1, -1), '/v1/auth/trust-status', u);
  assert.doesNotMatch(src, /trust-status\?/);
});

test('exactly one place calls trust-status, inside _trustStatus, through _api', () => {
  const calls = src.split('/v1/auth/trust-status').length - 1;
  const body = extractFn('_trustStatus');
  assert.equal(calls, 1, 'one call site');
  assert.match(body, /_api\('GET', '\/v1\/auth\/trust-status'\)/);
});

test('every former call site uses _trustStatus()', () => {
  const uses = src.match(/await _trustStatus\(\)/g) || [];
  assert.equal(uses.length, 4);
});

test('_trustStatus makes no request without a stored session', async () => {
  const seen = [];
  const make = Function('_getToken', '_api', extractFn('_trustStatus') + '\nreturn _trustStatus;');
  const noTok = make(() => null, async (m, p) => { seen.push([m, p]); return {}; });
  await assert.rejects(async () => noTok());
  assert.deepEqual(seen, []);
  const withTok = make(() => 'tok', async (m, p) => { seen.push([m, p]); return { trust_level: 'verified' }; });
  assert.deepEqual(await withTok(), { trust_level: 'verified' });
  assert.deepEqual(seen, [['GET', '/v1/auth/trust-status']]);
});

test('_api sends the session as Authorization: Bearer', () => {
  const api = extractFn('_api');
  assert.match(api, /headers\['Authorization'\] = `Bearer \$\{token\}`/);
});

test('pending_requests (other people) is never read', () => {
  assert.doesNotMatch(src, /pending_requests/);
});
