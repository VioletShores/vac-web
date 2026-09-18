'use strict';
// vd-04-risklevel-not-hardcoded.test.js — S194 VACVerify audit, divergence VD-04
// (docs/VACVERIFY-AUDIT-S194.md).
//
// VACReauth.run's `riskLevel` argument is the COPS/PID *input* (as opposed to
// reauth_modality_policy, which is the COPS/PID *output* the server returns on the challenge and
// which every phase-composition decision genuinely reads — see reauthPolicyRequired(),
// vac-reauth-ceremony.js:424). Today every current call site hardcodes riskLevel as a bare string
// literal ('low' or 'medium') rather than computing it from any runtime signal (transaction value,
// decision severity, tribunal case class, etc.) — the assurance level is a property of which page
// you're on, not of what you're about to do.
//
// This is also how VD-02 happened: financial-demo.html's VACReauth.run call carries
// context:'tribunal-view-credential', copy-pasted from tribunal-demo.html's call site, because
// there is no shared, explicit place that forces each page to state its own risk rationale.
//
// This test documents the gap as it stands today: it is marked `todo` (Node's xfail) and is
// EXPECTED TO FAIL until the unification slice (audit doc §6) makes riskLevel a value computed or
// explicitly justified per call, not a copy-pasted literal. No production code changed in this
// lane.
//
// Run: node --test tests/vd-04-risklevel-not-hardcoded.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CALL_SITES = [
    'auth.html',
    'vat-verify.html',
    'tribunal-demo.html',
    'financial-demo.html',
    'reauth-count-test.html',
];

function hardcodedRiskLevelLiterals(file) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    return [...src.matchAll(/riskLevel:\s*'([^']+)'/g)].map((m) => m[1]);
}

test('VD-04: no VACReauth.run call site hardcodes riskLevel as a bare string literal', { todo: true }, () => {
    const offenders = [];
    for (const file of CALL_SITES) {
        for (const literal of hardcodedRiskLevelLiterals(file)) {
            offenders.push(file + ' -> riskLevel:\'' + literal + '\'');
        }
    }
    assert.deepEqual(
        offenders,
        [],
        'every VACReauth.run call site should derive riskLevel from an explicit, page-documented ' +
        'assurance decision (or a shared helper), not a hardcoded literal — today all of these are ' +
        'bare strings: ' + offenders.join(', ')
    );
});
