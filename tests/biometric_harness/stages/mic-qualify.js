'use strict';
// mic-qualify.js — F-1202/S179 biometric harness: "Mic: working" preflight stage
//
// Source-anchored mirror, factored out of tests/mic-voiced-run.test.js's inline
// voicedRunTick/voicedRunPass/runMicFixtureThroughGate so the generalized harness
// can drive it with score/pass/latency alongside every other stage. Same caveat as
// that seed test: does not execute vac-reauth-ceremony.js in a browser — proves the
// mirror matches shipped source, not a substitute for a real-DOM/Playwright run.

const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes } = require('../lib/source-anchor');
const { rmsOfTdBuf, vbRatioOfFreqBuf } = require('../../fixtures/mic-test-audio-fixtures.js');

const src = readSrc(CEREMONY_SRC_PATH);

const VOICED_RUN_TICKS_NEEDED = constFromSource(src, 'VOICED_RUN_TICKS_NEEDED', CEREMONY_SRC_PATH);
const VOICED_RUN_MOD_DELTA = constFromSource(src, 'VOICED_RUN_MOD_DELTA', CEREMONY_SRC_PATH);
const VOICED_RUN_SPEECH_RMS_FLOOR = constFromSource(src, 'VOICED_RUN_SPEECH_RMS_FLOOR', CEREMONY_SRC_PATH);
const VOICED_RUN_SILENCE_RMS_FLOOR = constFromSource(src, 'VOICED_RUN_SILENCE_RMS_FLOOR', CEREMONY_SRC_PATH);
const VOICE_BAND_MIN_RATIO = constFromSource(src, 'VOICE_BAND_MIN_RATIO', CEREMONY_SRC_PATH);

function verifySource() {
    requireIncludes(src, 'const _micVoicedFrame = (_speechRatio >= VOICE_BAND_MIN_RATIO) && (_ceremonyRms > VOICED_RUN_SPEECH_RMS_FLOOR);',
        'mic-qualify mirror: _micVoicedFrame classifier not found — source has diverged');
    requireIncludes(src, 'const _micSilenceFrame = _ceremonyRms < VOICED_RUN_SILENCE_RMS_FLOOR;',
        'mic-qualify mirror: _micSilenceFrame classifier not found — source has diverged');
    requireIncludes(src, 'function _voicedRunPass(state, modOverride) {',
        'mic-qualify mirror: _voicedRunPass(state, modOverride) signature not found — the modOverride/_vadStarved escape hatch this mirror models may have changed shape');
    const trueAssignments = src.match(/avChecks\.mic\s*=\s*true/g) || [];
    if (trueAssignments.length !== 1) {
        throw new Error(`mic-qualify mirror: expected exactly 1 "avChecks.mic = true" assignment, found ${trueAssignments.length} — D-MICTEST-GREENS-ON-NOISE regression risk`);
    }
}

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

// modOverride mirrors vac-reauth-ceremony.js's _voicedRunPass(state, modOverride) (~L805): an
// already-proven voiced path (starved-analyser spectral proxy) skips the modulation check. No
// current fixture exercises modOverride=true (none simulate a starved analyser) — it defaults
// false, matching every fixture's real _vadStarved=false condition.
function voicedRunPass(state, modOverride) {
    return state.ticks >= VOICED_RUN_TICKS_NEEDED && (!!modOverride || (state.max - state.min) >= VOICED_RUN_MOD_DELTA);
}

// frames: [{ tdBuf, freqBuf }]
function run(frames, modOverride) {
    const t0 = process.hrtime.bigint();
    const state = newVoicedRunState();
    let everPassed = false;
    let passedAtFrame = null;
    for (let i = 0; i < frames.length; i++) {
        const rms = rmsOfTdBuf(frames[i].tdBuf);
        const vbRatio = vbRatioOfFreqBuf(frames[i].freqBuf);
        const isVoicedFrame = (vbRatio >= VOICE_BAND_MIN_RATIO) && (rms > VOICED_RUN_SPEECH_RMS_FLOOR);
        const isSilenceFrame = rms < VOICED_RUN_SILENCE_RMS_FLOOR;
        voicedRunTick(state, rms, isVoicedFrame, isSilenceFrame);
        if (voicedRunPass(state, modOverride)) { everPassed = true; passedAtFrame = i; break; }
    }
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        pass: everPassed,
        score: everPassed ? 1 : 0,
        latencyMs,
        detail: { passedAtFrame, finalTicks: state.ticks, finalMod: parseFloat((state.max - state.min).toFixed(4)) },
    };
}

module.exports = {
    name: 'mic_qualify',
    verifySource,
    run,
    newVoicedRunState, voicedRunTick, voicedRunPass, // exported so phrase-gate.js reuses these instead of hand-copying
    constants: { VOICED_RUN_TICKS_NEEDED, VOICED_RUN_MOD_DELTA, VOICED_RUN_SPEECH_RMS_FLOOR, VOICED_RUN_SILENCE_RMS_FLOOR, VOICE_BAND_MIN_RATIO },
};
