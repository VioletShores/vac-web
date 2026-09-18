'use strict';
// vd-01-gesture-primitive-parity.test.js — S194 VACVerify audit, divergence VD-01
// (docs/VACVERIFY-AUDIT-S194.md).
//
// vac-auth.js has its own bespoke quick-reauth ceremony (_renderQuickReauthScreen /
// _handleReauthCapture, vac-auth.js:918-1050): a single JPEG frame with a static "hold up N
// fingers" challenge, verified server-side only. It shares NO code with window.FingerDetector
// (vac-finger-detect.js, the shared real-time gesture module every other ceremony entry point
// uses) and does not call window.VACReauth.run at all.
//
// Consequence: F-766/F-766b (918bf07, 5288b2b, 2026-07-13 — THUMB_SPREAD_MIN/THUMB_BEND_MAX
// loosened after Rob live-diagnosed a genuine open-hand 5 reading as 4, a false-deny) fixed the
// gesture false-deny for every entry point built on FingerDetector, but never reached vac-auth.js's
// path — it can't, structurally, since vac-auth.js never calls FingerDetector.
//
// This test documents the gap as it stands today: it is marked `todo` (Node's xfail) and is
// EXPECTED TO FAIL until the unification slice (audit doc §6) routes vac-auth.js's quick-reauth
// through VACReauth.run. No production code changed in this lane.
//
// Run: node --test tests/vd-01-gesture-primitive-parity.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'vac-auth.js'), 'utf8');

test('VD-01: vac-auth.js quick-reauth shares the FingerDetector gesture primitive', { todo: true }, () => {
    assert.ok(
        /FingerDetector/.test(src),
        'vac-auth.js should reference window.FingerDetector (the shared real-time gesture module ' +
        'that received the F-766/F-766b thumb-threshold fix) so a future gesture fix reaches this ' +
        'path automatically — today it captures a single static frame and trusts server-side finger ' +
        'counting exclusively, with zero client-side gesture code shared with the rest of the ceremony.'
    );
});

test('VD-01: vac-auth.js quick-reauth is routed through VACReauth.run, not a bespoke capture', { todo: true }, () => {
    assert.ok(
        /VACReauth\.run/.test(src),
        'vac-auth.js should call VACReauth.run for its quick-reauth flow (as vat-verify.html, ' +
        'tribunal-demo.html and financial-demo.html already do for their fast-tier re-auth) instead ' +
        'of its own _renderQuickReauthScreen/_handleReauthCapture implementation ' +
        '(vac-auth.js:918-1050) against a separate /v1/auth/face-reauth endpoint.'
    );
});
