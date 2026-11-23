// vac-auth-quick-reauth.test.js — S206.
//
// vac-auth.js shows quick re-auth after the session has expired. It does not
// make a separate enrolment pre-check: it goes straight to the finger challenge
// and routes the server's structured "not enrolled" answers
// (no_face_reference / empty_face_reference / no_embedding / require_full_auth)
// to full verification with an honest message.
//
// Source-level checks: vac-auth.js is a DOM-bound widget with no unit harness.
// Run: node --test tests/vac-auth-quick-reauth.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vac-auth.js'), 'utf8');
const start = SRC.indexOf('function _renderQuickReauthScreen(email)');
const body = SRC.slice(start, SRC.indexOf('\n  function ', start + 10));

test('quick re-auth makes no separate enrolment-status call', () => {
  assert.ok(start > 0);
  assert.doesNotMatch(SRC, /_api\(\s*'GET',\s*'\/v1\/auth\/face-ref-status/);
  assert.doesNotMatch(SRC, /fetch\([^)]*face-ref-status/);
});

test('quick re-auth starts with the finger challenge', () => {
  const first = body.indexOf("_api('GET', '/v1/auth/face-reauth-challenge?email='");
  assert.ok(first > 0, 'challenge is requested directly');
  assert.equal(body.indexOf('_api(', 0), first, 'it is the first API call on this screen');
});

test('structured not-enrolled and require_full_auth answers route to full verification', () => {
  const handler = SRC.slice(SRC.indexOf("console.log('[VAC] Face re-auth failed:', msg);"));
  for (const code of ['no_face_reference', 'empty_face_reference', 'no_embedding']) {
    assert.match(handler, new RegExp("code === '" + code + "'"), code);
  }
  assert.match(handler, /det\.require_full_auth === true/);
  assert.match(handler, /code === 'reauth_max_retries'/, 'the server\'s max-retries code ends in full verification');
  assert.match(handler, /e\._detail/, 'reads the structured detail, not only the message text');
  assert.match(handler, /Quick re-verification is not set up/);
  assert.match(handler, /Face did not match the verified identity/, 'a genuine mismatch keeps its message');
});
