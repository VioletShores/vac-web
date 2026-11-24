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

test('S207: shipped preflight needs 1000 ms of modulated voiced time at 60 Hz, phrase needs seven ticks; unseeded mic holds', () => {
    // 60 frames at 60 Hz: the first frame has no elapsed time, so 59 x 16.7 ms < 1000 ms.
    assert.equal(mic.run(speech(60)).pass, false);
    const r = mic.run(speech(62));
    assert.equal(r.pass, true);
    assert.ok(r.detail.voicedMs >= 1000 && r.detail.passedAtMs <= 1050, JSON.stringify(r.detail));
    // cadence-independent: at 30 Hz the same voiced TIME passes with half the frames
    assert.equal(mic.run(speech(31), { frameMs: 1000 / 30 }).pass, false);
    assert.equal(mic.run(speech(32), { frameMs: 1000 / 30 }).pass, true);
    assert.equal(mic.run(speech(200), { seeded: false }).pass, false);
    assert.equal(phrase.run(speech(6)).pass, false);
    assert.equal(phrase.run(speech(7)).pass, true);
});
test('S207: a frame gap is capped at 100 ms, so a stalled tab cannot credit a long gap as voice', () => {
    assert.equal(mic.run(speech(6), { frameMs: 1000 }).pass, false);
    assert.equal(mic.run(speech(12), { frameMs: 1000 }).pass, true);   // 11 x 100 ms capped
});
test('S207: tuning is read from the shipped _vacTune defaults and their clamps', () => {
    const c = mic.constants;
    assert.equal(c.MIC_VOICED_MS_NEEDED, 1000);
    assert.equal(c.MIC_RMS_FLOOR, 0.035);
    assert.equal(c.MIC_AMBIENT_MULT, 2);
    const src = readSrc(CEREMONY_SRC_PATH);
    assert.deepEqual(mic.tunedDefault(src, 'MIC_RMS_FLOOR'), { value: 0.035, min: 0.031, max: 0.055 },
        'the floor can never be tuned below the silence floor or above the old fixed floor');
    const gate = mic.compile();
    assert.equal(gate.nearFieldGate(0), 0.035);
    assert.equal(gate.nearFieldGate(0.02), 0.04);
    assert.equal(gate.nearFieldGate(0.05), 0.055, 'capped: never stricter than the old fixed floor');
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
    const samples = (level, voice = 0, other = 0) => Array.from({ length: 70 }, () => frame(0, level, voice, other));
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
    const changed = source.replace("const MIC_VOICED_MS_NEEDED = _vacTune('micVoicedMs', 1000, 600, 2000);",
                                   "const MIC_VOICED_MS_NEEDED = _vacTune('micVoicedMs', 1500, 600, 2000);");
    assert.notEqual(changed, source);
    assert.equal(mic.run(speech(80), { source }).pass, true, 'shipped 1000 ms');
    assert.equal(mic.run(speech(80), { source: changed }).pass, false, 'the extracted code follows the edited source');
    assert.equal(mic.run(speech(95), { source: changed }).pass, true);
    assert.throws(() => mic.compile(source.replace('if (_micSeeded && _micPreflightPass(_micVoicedState, _micOnFallback))', 'if (true)')), /expected source/);
    assert.throws(() => mic.compile(source.replace('_micVoicedMsTick(_micVoicedState, _nowT, _micVoicedFrame, _micSilenceFrame);', '')), /expected source/);
});
test('source extraction refuses missing, ambiguous and truncated functions', () => {
    assert.throws(() => functionFromSource('', '_missing'), /expected one/);
    assert.throws(() => functionFromSource('function x() {\n}\nfunction x() {\n}', 'x'), /expected one/);
    assert.throws(() => functionFromSource('function x() {\n', 'x'), /missing function end/);
});
