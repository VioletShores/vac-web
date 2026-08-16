'use strict';
// mic-voiced-run.test.js — S166 task-mictest-voiced-only step 4/5 (D-MICTEST-GREENS-ON-NOISE)
//
// WHAT THIS IS: a Node mirror tier (same pattern as tests/vad-replay.test.js and
// task-f1139-ceremony-harness's tests/ceremony-gate-harness.test.js @f662285) — source-anchored
// constant/pattern extraction + a hand-written mirror of the shared _voicedRunTick/_voicedRunPass
// predicate (vac-reauth-ceremony.js ~L756-778) and the mic-qualify frame classifiers it feeds
// (~L1558-1559). It does not execute vac-reauth-ceremony.js in a browser — this proves the mirror
// (and therefore the gate math it tracks) is internally consistent and matches shipped source; it
// is not a substitute for a real-DOM/Playwright run of the actual gate.
//
// Fixtures: tests/fixtures/mic-test-audio-fixtures.js — silence, door_slam, far_field_tv_speech,
// near_field_real_speech. Requirement under test: "Mic: working" must green on near_field_real_speech
// ONLY — the other three (a door slam, a distant TV playing dialogue, true silence) must never
// accumulate a qualifying voiced run, matching the fix in commit 2aa40b2 (mic test no longer greens
// on any energy-rise-above-ambient, only on the same sustained/modulated/voice-band-dominant run
// the greeting gate requires).
//
// Run: node --test tests/mic-voiced-run.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIC_FIXTURES, VOICED_RUN_SPEECH_RMS_FLOOR, VOICED_RUN_SILENCE_RMS_FLOOR, VOICE_BAND_MIN_RATIO,
        rmsOfTdBuf, vbRatioOfFreqBuf } = require('./fixtures/mic-test-audio-fixtures');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in ${SRC_PATH} — mirror and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.equal(typeof value, 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// ── Source-anchor tests ────────────────────────────────────────────────────

test('shared voiced-run constants match what this mirror/fixture set was built against', () => {
    assert.equal(constFromSource('VOICED_RUN_TICKS_NEEDED'), 7);
    assert.equal(constFromSource('VOICED_RUN_MOD_DELTA'), 0.045);
    assert.equal(constFromSource('VOICED_RUN_SPEECH_RMS_FLOOR'), VOICED_RUN_SPEECH_RMS_FLOOR);
    assert.equal(constFromSource('VOICED_RUN_SILENCE_RMS_FLOOR'), VOICED_RUN_SILENCE_RMS_FLOOR);
    assert.equal(constFromSource('VOICE_BAND_MIN_RATIO'), VOICE_BAND_MIN_RATIO);
});

test('mic-qualify frame classifier matches source verbatim', () => {
    assert.ok(
        src.includes('const _micVoicedFrame = (_speechRatio >= VOICE_BAND_MIN_RATIO) && (_ceremonyRms > VOICED_RUN_SPEECH_RMS_FLOOR);'),
        '_micVoicedFrame classifier expression not found or changed — mirror is stale'
    );
    assert.ok(
        src.includes('const _micSilenceFrame = _ceremonyRms < VOICED_RUN_SILENCE_RMS_FLOOR;'),
        '_micSilenceFrame classifier expression not found or changed — mirror is stale'
    );
});

test('D-MICTEST-DIAG-NOT-AMPLITUDE-ONLY: pending (stuck) diagnostic carries the same voiced_ticks/mod/vb_ratio/near_field_rms shape as the pass diagnostic', () => {
    assert.ok(
        src.includes("vacDebug('mic_qualify_pending', null, { voiced_ticks: _micVoicedState.ticks, mod: Number((_micVoicedState.max - _micVoicedState.min).toFixed(3)), vb_ratio: Number(_speechRatio.toFixed(3)), near_field_rms: Number(_ceremonyRms.toFixed(3)) })"),
        'mic_qualify_pending diagnostic missing or its field shape changed — field debugging of a STUCK mic test needs the same voiced_ticks/mod/vb_ratio/near_field_rms fields as the pass path, not amplitude alone'
    );
});

test('D-MICTEST-GREENS-ON-NOISE regression guard: avChecks.mic is set ONLY from the voiced-run pass, not the ambient-rise sustain', () => {
    // The old bug: _avVbSustain >= 25 (rise above slow ambient) used to set avChecks.mic directly.
    // Guard that the ambient-rise block no longer does that, and the only avChecks.mic = true
    // assignment in the file is gated behind _voicedRunPass(_micVoicedState, ...).
    const trueAssignments = src.match(/avChecks\.mic\s*=\s*true/g) || [];
    assert.equal(trueAssignments.length, 1, `expected exactly 1 "avChecks.mic = true" assignment in source, found ${trueAssignments.length}`);
    const idx = src.indexOf('avChecks.mic = true');
    const windowBefore = src.slice(Math.max(0, idx - 1500), idx);
    assert.ok(
        windowBefore.includes('_voicedRunPass(_micVoicedState'),
        'avChecks.mic = true is not gated by _voicedRunPass(_micVoicedState, ...) — the mic gate may have regressed to the ambient-rise path'
    );
    assert.ok(
        !src.includes('_avVbSustain >= 25 && !avChecks.mic) {\n                avChecks.mic = true'),
        'ambient-rise sustain block appears to directly set avChecks.mic again — D-MICTEST-GREENS-ON-NOISE regression'
    );
});

// ── Mirror of _newVoicedRunState/_voicedRunTick/_voicedRunPass (vac-reauth-ceremony.js ~L756-778) ──

function newVoicedRunState() { return { ticks: 0, min: 1, max: 0 }; }

function voicedRunTick(state, rms, isVoicedFrame, isSilenceFrame) {
    if (isVoicedFrame) {
        state.ticks++;
        if (rms < state.min) state.min = rms;
        if (rms > state.max) state.max = rms;
    } else if (isSilenceFrame) {
        state.ticks = Math.max(0, state.ticks - 1);
        if (state.ticks === 0) { state.min = 1; state.max = 0; }
    }
    return state;
}

function voicedRunPass(state, modOverride) {
    return state.ticks >= 7 /* VOICED_RUN_TICKS_NEEDED */
        && (!!modOverride || (state.max - state.min) >= 0.045 /* VOICED_RUN_MOD_DELTA */);
}

// Mirror of the mic-qualify frame classifiers (~L1558-1559): drives voicedRunTick from a
// (tdBuf, freqBuf) pair the same way runAVFrame derives _ceremonyRms/_speechRatio.
function runMicFixtureThroughGate(fixture) {
    const state = newVoicedRunState();
    let everPassed = false;
    for (const frame of fixture.frames) {
        const rms = rmsOfTdBuf(frame.tdBuf);
        const vbRatio = vbRatioOfFreqBuf(frame.freqBuf);
        const isVoicedFrame = (vbRatio >= VOICE_BAND_MIN_RATIO) && (rms > VOICED_RUN_SPEECH_RMS_FLOOR);
        const isSilenceFrame = rms < VOICED_RUN_SILENCE_RMS_FLOOR;
        voicedRunTick(state, rms, isVoicedFrame, isSilenceFrame);
        if (voicedRunPass(state, false)) { everPassed = true; break; }
    }
    return { everPassed, finalTicks: state.ticks, finalMod: parseFloat((state.max - state.min).toFixed(4)) };
}

// ── Replay each fixture, assert MIC_GREENS only on near_field_real_speech ─────

for (const [name, fixture] of Object.entries(MIC_FIXTURES)) {
    test(`mic-qualify gate: ${name} -> ${fixture.expectedOutcome}`, () => {
        const result = runMicFixtureThroughGate(fixture);
        if (fixture.expectedOutcome === 'MIC_GREENS') {
            assert.ok(result.everPassed, `${name}: expected the voiced-run gate to pass (MIC_GREENS) but it never did (ticks=${result.finalTicks}, mod=${result.finalMod})`);
        } else {
            assert.ok(!result.everPassed, `${name}: expected the voiced-run gate to stay stuck (MIC_STUCK) but it passed (ticks=${result.finalTicks}, mod=${result.finalMod})`);
        }
    });
}

test('exactly one fixture (near_field_real_speech) greens the mic — the other three never do', () => {
    const outcomes = Object.entries(MIC_FIXTURES).map(([name, fx]) => [name, runMicFixtureThroughGate(fx).everPassed]);
    const passing = outcomes.filter(([, passed]) => passed).map(([name]) => name);
    assert.deepEqual(passing, ['near_field_real_speech'], `expected only near_field_real_speech to pass, got: ${JSON.stringify(outcomes)}`);
});
