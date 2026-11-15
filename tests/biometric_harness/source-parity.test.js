'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mic = require('./stages/mic-qualify');
const phrase = require('./stages/phrase-gate');
const { readSrc, CEREMONY_SRC_PATH, functionFromSource } = require('./lib/source-anchor');
const { makeTdBufRms, makeFreqBufVbr } = require('../fixtures/mic-test-audio-fixtures');
const frame = (rms, recorderLevel = 0, voice = 80, other = 2) => ({ tdBuf: makeTdBufRms(rms), freqBuf: makeFreqBufVbr(voice, other), recorderLevel });
const speech = n => Array.from({ length: n }, (_, i) => frame(i % 2 ? 9 / 128 : 15 / 128));
const silence = n => Array.from({ length: n }, () => frame(0, 0, 0, 0));

test('shipped preflight needs four modulated ticks, phrase needs seven; unseeded mic holds', () => {
    assert.equal(mic.run(speech(3)).pass, false);
    assert.equal(mic.run(speech(4)).pass, true);
    assert.equal(mic.run(speech(8), { seeded: false }).pass, false);
    assert.equal(phrase.run(speech(6)).pass, false);
    assert.equal(phrase.run(speech(7)).pass, true);
});
test('actual shared tracker holds neutral frames and decays/reset genuine silence', () => {
    const state = mic.newVoicedRunState(4);
    mic.voicedRunTick(state, .1, true, false);
    mic.voicedRunTick(state, .04, false, false);
    assert.equal(state.ticks, 1);
    mic.voicedRunTick(state, 0, false, true);
    assert.equal(state.ticks, 0); assert.equal(state.min, 1); assert.equal(state.max, 0);
    assert.equal(mic.voicedRunPass(state, true), false);
});
test('recorder fallback requires explicit fallback, level eight and spectrum agreement/abstention', () => {
    const samples = (level, voice = 0, other = 0) => Array.from({ length: 4 }, () => frame(0, level, voice, other));
    assert.equal(mic.run(samples(8)).pass, false);
    assert.equal(mic.run(samples(7), { fallback: true }).pass, false);
    assert.equal(mic.run(samples(8), { fallback: true }).pass, true);
    assert.equal(mic.run(samples(8, 1, 20), { fallback: true }).pass, false);
    assert.throws(() => mic.run(speech(8), true), /explicit context/);
});
test('phrase strong-band admits a modulated low/high run but rejects flat TV and near-silence', () => {
    const mixed = Array.from({ length: 7 }, (_, i) => frame(i % 2 ? 4 / 128 : 12 / 128));
    assert.equal(phrase.run(mixed, { noiseFloor: .03, threshold: .2 }).pass, true);
    assert.equal(phrase.run(Array.from({ length: 30 }, () => frame(6 / 128))).pass, false);
    assert.equal(phrase.run(Array.from({ length: 30 }, () => frame(1 / 128))).pass, false);
});
test('starved phrase requires actual recorder evidence, not starvation alone', () => {
    assert.equal(phrase.run(silence(30)).pass, false);
    const r = phrase.run([...silence(21), ...Array.from({ length: 7 }, () => frame(0, 8, 0, 0))]);
    assert.equal(r.pass, true); assert.equal(r.detail.starved, true);
    assert.equal(phrase.run([...silence(21), ...Array.from({ length: 7 }, () => frame(0, 7, 0, 0))]).pass, false);
});
test('phrase freezes the accepted tracker and completes only after two silent ticks', () => {
    const one = phrase.run([...speech(7), ...silence(1)]);
    assert.equal(one.pass, true); assert.equal(one.detail.utteranceComplete, false);
    const two = phrase.run([...speech(7), ...silence(20)]);
    assert.equal(two.detail.utteranceComplete, true); assert.equal(two.detail.finalTicks, 7);
});
test('changing shipped preflight threshold changes extracted execution, not a handwritten mirror', () => {
    const source = readSrc(CEREMONY_SRC_PATH);
    const changed = source.replace('const MIC_PREFLIGHT_TICKS_NEEDED = 4;', 'const MIC_PREFLIGHT_TICKS_NEEDED = 5;');
    assert.notEqual(changed, source);
    const gate = mic.compile(changed), state = gate.preflightState();
    for (let i = 0; i < 4; i++) assert.equal(gate.frame(state, makeTdBufRms(i % 2 ? .07 : .12), makeFreqBufVbr(80, 2), false, 0, true), false);
    assert.equal(gate.frame(state, makeTdBufRms(.12), makeFreqBufVbr(80, 2), false, 0, true), true);
    assert.throws(() => mic.compile(source.replace('if (_micSeeded && _voicedRunPass(_micVoicedState, _micOnFallback))', 'if (true)')), /expected source/);
});
test('source extraction refuses missing, ambiguous and truncated functions', () => {
    assert.throws(() => functionFromSource('', '_missing'), /expected one/);
    assert.throws(() => functionFromSource('function x() {\n}\nfunction x() {\n}', 'x'), /expected one/);
    assert.throws(() => functionFromSource('function x() {\n', 'x'), /missing function end/);
});
