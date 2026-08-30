'use strict';
// phrase-gate.js — F-1202/S179 biometric harness: spoken-greeting phrase stage
//
// Source-anchored mirror of the phrase (greeting) voiced-run gate in
// vac-reauth-ceremony.js (~L4957-5203): PHRASE_VOICED_TICKS_NEEDED/PHRASE_MOD_DELTA
// are declared as direct aliases of the mic-qualify gate's VOICED_RUN_TICKS_NEEDED/
// VOICED_RUN_MOD_DELTA (L4976-4977) and the pass condition is the SAME
// _voicedRunPass(_phraseVoicedState, _vadStarved) function (L5181) the mic-qualify
// gate uses — this module calls stages/mic-qualify.js's exported
// voicedRunTick/voicedRunPass directly (not a hand-copy), so the two stages cannot
// silently drift against each other. Not a substitute for a real-DOM/Playwright
// run (no live AudioContext/content-gate here) — see mic-qualify.js's header for
// the same caveat.

const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes } = require('../lib/source-anchor');
const micQualify = require('./mic-qualify');
const { rmsOfTdBuf, vbRatioOfFreqBuf } = require('../../fixtures/mic-test-audio-fixtures.js');

const src = readSrc(CEREMONY_SRC_PATH);

const PHRASE_SILENCE_TICKS_NEEDED = constFromSource(src, 'PHRASE_SILENCE_TICKS_NEEDED', CEREMONY_SRC_PATH);

function verifySource() {
    requireIncludes(src, 'const PHRASE_VOICED_TICKS_NEEDED = VOICED_RUN_TICKS_NEEDED;',
        'phrase-gate mirror: PHRASE_VOICED_TICKS_NEEDED is no longer aliased to VOICED_RUN_TICKS_NEEDED — mic-qualify.js constants no longer apply, mirror has diverged');
    requireIncludes(src, 'const PHRASE_MOD_DELTA = VOICED_RUN_MOD_DELTA;',
        'phrase-gate mirror: PHRASE_MOD_DELTA is no longer aliased to VOICED_RUN_MOD_DELTA — mirror has diverged');
    requireIncludes(src, '_voicedRunTick(_phraseVoicedState, _rms, _voicedFrame,',
        'phrase-gate mirror: _phraseVoicedState tick call not found — source has diverged');
    requireIncludes(src, 'if (_voicedRunPass(_phraseVoicedState, _vadStarved))',
        'phrase-gate mirror: _phraseVoicedState pass check not found — source has diverged');
    micQualify.verifySource(); // this stage reuses mic-qualify's tick/pass — their anchors apply here too
}

// frames: [{ tdBuf, freqBuf }]
// modOverride mirrors the real _vadStarved argument to _voicedRunPass (see mic-qualify.js) —
// no current fixture simulates a starved analyser, so it defaults false.
function run(frames, modOverride) {
    const t0 = process.hrtime.bigint();
    const { VOICED_RUN_TICKS_NEEDED, VOICED_RUN_SPEECH_RMS_FLOOR, VOICED_RUN_SILENCE_RMS_FLOOR, VOICE_BAND_MIN_RATIO } = micQualify.constants;
    const state = micQualify.newVoicedRunState();
    let everPassed = false;
    let passedAtFrame = null;
    let silenceTailTicks = 0;
    let utteranceComplete = false;

    for (let i = 0; i < frames.length; i++) {
        const rms = rmsOfTdBuf(frames[i].tdBuf);
        const vbRatio = vbRatioOfFreqBuf(frames[i].freqBuf);
        const isVoicedFrame = (vbRatio >= VOICE_BAND_MIN_RATIO) && (rms > VOICED_RUN_SPEECH_RMS_FLOOR);
        const isSilenceFrame = rms < VOICED_RUN_SILENCE_RMS_FLOOR;

        micQualify.voicedRunTick(state, rms, isVoicedFrame, isSilenceFrame);

        if (isSilenceFrame && (state.ticks >= VOICED_RUN_TICKS_NEEDED || everPassed)) {
            if (++silenceTailTicks >= PHRASE_SILENCE_TICKS_NEEDED) utteranceComplete = true;
        } else if (isVoicedFrame) {
            silenceTailTicks = 0;
        }

        if (!everPassed && micQualify.voicedRunPass(state, modOverride)) {
            everPassed = true;
            passedAtFrame = i;
        }
    }

    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        pass: everPassed,
        score: everPassed ? 1 : 0,
        latencyMs,
        detail: { passedAtFrame, finalTicks: state.ticks, finalMod: parseFloat((state.max - state.min).toFixed(4)), utteranceComplete },
    };
}

module.exports = {
    name: 'phrase_gate',
    verifySource,
    run,
    constants: { PHRASE_SILENCE_TICKS_NEEDED },
};
