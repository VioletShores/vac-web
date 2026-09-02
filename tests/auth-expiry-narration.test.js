'use strict';
// auth-expiry-narration.test.js — s182 ceremony UX bundle: expiry narration on auth.html
//
// auth.html purges a stored ceremony result older than 24h on load (F-563 c). It used to do so
// silently — the user landed on the identity form with no idea their authority had lapsed. s182
// narrates it: "previous authority expired after 24h — quick renewal not yet enabled — full
// ceremony required". Pure function extracted from the inline script; wiring anchored by regex.
//
// Run: node --test tests/auth-expiry-narration.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function extractFn(name) {
    const start = inline.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' not found in auth.html inline script');
    let depth = 0, i = start;
    while (i < inline.length && depth === 0) { if (inline[i] === '{') depth++; i++; }
    while (i < inline.length) { if (inline[i] === '{') depth++; else if (inline[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    return inline.slice(start, i);
}
const ttl = inline.match(/var VAC_AUTHORITY_TTL_MS = ([^;]+);/);
assert.ok(ttl, 'VAC_AUTHORITY_TTL_MS present');
const vacExpiryNarration = Function('var VAC_AUTHORITY_TTL_MS = ' + ttl[1] + ';\n' + extractFn('vacExpiryNarration') + '\nreturn vacExpiryNarration;')();
const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-02T10:00:00Z');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

test('TC-AEN-01: 24h TTL; an aged authority narrates expiry + no quick renewal + full ceremony', () => {
    assert.equal(Function('return ' + ttl[1])(), 24 * H);
    const t = vacExpiryNarration(NOW - 25 * H, NOW);
    assert.equal(t, 'Your previous authority expired after 24 hours. Quick renewal is not yet enabled, so a full ceremony is required.');
    assert.ok(!EMOJI.test(t));
});

test('TC-AEN-02: a fresh authority (<= 24h) and a missing/invalid timestamp narrate nothing', () => {
    assert.equal(vacExpiryNarration(NOW - 23 * H, NOW), '');
    assert.equal(vacExpiryNarration(NOW - 24 * H, NOW), '', 'exactly 24h is still fresh (matches the prior > comparison)');
    assert.equal(vacExpiryNarration(undefined, NOW), '');
    assert.equal(vacExpiryNarration('yesterday', NOW), '');
    assert.equal(vacExpiryNarration(0, NOW), '');
});

test('TC-AEN-03: the pre-fill boot path purges the aged blob, keeps the identity pre-fill and shows the note', () => {
    const i = inline.indexOf("const saved = localStorage.getItem('vac_verified');");
    const block = inline.slice(i, i + 1200);
    assert.ok(/var _expiryText = vacExpiryNarration\(data\.timestamp, Date\.now\(\)\);/.test(block));
    assert.ok(/if \(_expiryText\) \{[\s\S]*localStorage\.removeItem\('vac_verified'\);[\s\S]*vacShowExpiryNote\(_expiryText\);[\s\S]*return;/.test(block), 'purge -> note -> return');
    assert.ok(/_xe\.value = data\.email/.test(block), 'identity pre-fill kept for convenience');
});

test('TC-AEN-04: the note lives in step 0, dark surface with the gold #C9A227 label, and is hidden by default', () => {
    const step0 = html.slice(html.indexOf('id="step0"'), html.indexOf('id="vacReauthMount"'));
    assert.ok(/<div id="vacExpiryNote" style="display:none;background:var\(--surface\);[^"]*border-left:3px solid #C9A227;/.test(step0));
    assert.ok(/color:#C9A227;[^"]*">Previous authority<\/div>/.test(step0));
    assert.ok(/<span id="vacExpiryNoteText"><\/span>/.test(step0));
    assert.ok(!EMOJI.test(step0.slice(step0.indexOf('vacExpiryNote'), step0.indexOf('vacExpiryNoteText') + 40)));
});

test('TC-AEN-05: auth.html loads the s182 ceremony pin (the mic fix bytes actually reach browsers)', () => {
    assert.ok(html.includes('/vac-reauth-ceremony.js?v=s182'));
});
