'use strict';
// S207: ceremony pacing tuning. Every value in vac-ceremony-tuning.js is clamped by the
// ceremony's _vacTune, a bad or missing value falls back to the built-in default, and the
// shipped tuning file carries exactly the built-in defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
const tuningSrc = fs.readFileSync(path.join(__dirname, '..', 'vac-ceremony-tuning.js'), 'utf8');

function fnSource(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    return src.slice(start, i + 1);
}
const CALLS = [...src.matchAll(/const (\w+) = _vacTune\('(\w+)', ([0-9.]+), ([0-9.]+), ([0-9.]+)\);/g)]
    .map(m => ({ constName: m[1], key: m[2], dflt: Number(m[3]), lo: Number(m[4]), hi: Number(m[5]) }));

function tuneWith(tuning) {
    const ctx = vm.createContext({ window: tuning === undefined ? {} : { VAC_CEREMONY_TUNING: tuning } });
    vm.runInContext(fnSource('_vacTune'), ctx);
    return (c) => vm.runInContext(`_vacTune(${JSON.stringify(c.key)}, ${c.dflt}, ${c.lo}, ${c.hi})`, ctx);
}

test('six tunable pacing values, each with a default inside its clamp', () => {
    assert.deepEqual(CALLS.map(c => c.key).sort(),
        ['cantHearMinShowMs', 'digitOnsetGraceMs', 'digitRetryCueMs', 'micAmbientMult', 'micRmsFloor', 'micVoicedMs']);
    for (const c of CALLS) assert.ok(c.lo <= c.dflt && c.dflt <= c.hi, c.key);
});

test('no tuning object, or a bad value -> the built-in default', () => {
    for (const c of CALLS) {
        assert.equal(tuneWith(undefined)(c), c.dflt, c.key);
        assert.equal(tuneWith({ [c.key]: 'abc' })(c), c.dflt, c.key);
        assert.equal(tuneWith({ [c.key]: NaN })(c), c.dflt, c.key);
        for (const notNumber of [null, '', true, '0.04', [], {}]) {
            assert.equal(tuneWith({ [c.key]: notNumber })(c), c.dflt, `${c.key} = ${JSON.stringify(notNumber)}`);
        }
    }
});

test('out-of-range overrides are clamped, so noise can never be let in by config', () => {
    for (const c of CALLS) {
        assert.equal(tuneWith({ [c.key]: -1e9 })(c), c.lo, c.key);
        assert.equal(tuneWith({ [c.key]: 1e9 })(c), c.hi, c.key);
        assert.equal(tuneWith({ [c.key]: Infinity })(c), c.dflt, c.key);
    }
    const floor = CALLS.find(c => c.key === 'micRmsFloor');
    assert.ok(floor.lo > 0.030, 'the mic floor can never be tuned to or below the silence floor (0.030)');
    assert.ok(floor.hi <= 0.055, 'nor above the old fixed near-field floor');
});

test('the shipped tuning file carries exactly the built-in defaults', () => {
    const ctx = vm.createContext({ window: {} });
    vm.runInContext(tuningSrc, ctx);
    const t = ctx.window.VAC_CEREMONY_TUNING;
    assert.deepEqual(Object.keys(t).sort(), CALLS.map(c => c.key).sort());
    for (const c of CALLS) assert.equal(t[c.key], c.dflt, c.key);
});

test('auth.html loads the tuning file before the ceremony; vercel serves it uncached', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8');
    const a = html.indexOf('/vac-ceremony-tuning.js'), b = html.indexOf('/vac-reauth-ceremony.js');
    assert.ok(a > 0 && b > a);
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
    const h = (vercel.headers || []).find(x => x.source === '/vac-ceremony-tuning.js');
    assert.ok(h && h.headers.some(k => k.key === 'Cache-Control' && /no-store/.test(k.value)));
});

test('the voice-band and modulation bars are NOT tunable', () => {
    for (const fixed of ['const VOICE_BAND_MIN_RATIO = 0.45;', 'const VOICED_RUN_MOD_DELTA = 0.045;',
                         'const VOICED_RUN_SILENCE_RMS_FLOOR = 0.030;', 'const VOICED_RUN_SPEECH_RMS_FLOOR = 0.055;']) {
        assert.ok(src.includes(fixed), fixed);
    }
    assert.doesNotMatch(tuningSrc, /voiceBand|modDelta|silenceFloor/i);
});

test('digit pacing: retry cue, can’t-hear debounce and per-digit reset are wired', () => {
    assert.match(src, /if \(voiced > 0 && _now >= speechWindowStart && !speechReady\[currentDigitIndex\] && \(_now - _voiceOnsetAt\) >= 120\) _digitRetryCueAt = _now;/);
    assert.match(src, /Didn\\u2019t catch that \\u2014 say \\u201c' \+ _curDigit \+ '\\u201d again/);
    assert.match(src, /var _cantHearShow = _cantHearNow \|\| \(_cantHearShownAt > 0 && \(_now - _cantHearShownAt\) < CANT_HEAR_MIN_SHOW_MS\);/);
    assert.match(src, /_noTranscriptPendingFor = null; _digitRetryCueAt = 0; _cantHearShownAt = 0;/);
    assert.match(src, /Say: \\u201cTesting one, two, three\\u201d/);
    assert.doesNotMatch(src, /Say your name out loud/);
});
