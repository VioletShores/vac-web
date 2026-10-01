'use strict';
// digit-voice.js — F-1202/S179 biometric harness: digit-gate stage
//
// Source-anchored mirror of the FULL-PATH digit voice gate in
// vac-reauth-ceremony.js's beginRecording()/_startSpeechGate tick (~L4140-4280),
// the same pattern tests/mic-voiced-run.test.js established for the mic-qualify
// gate: this does not execute the shipped source in a browser (it needs a live
// AudioContext/analyser) — it proves a hand-written mirror stays internally
// consistent with the source's named constants and fire-condition expression.
// Not a substitute for a real-DOM/Playwright run.
//
// Fire condition mirrored from source (L4219-4222 / L4249-4252):
//   voiced-run elapsed >= DIGIT_VOICE_MIN_MS
//   AND (voiceMax - voiceMin) >= max(0.012, 0.10 * voiceMax)   [relative modulation floor, S154]
//   AND framesAboveThr >= VOICE_EVIDENCE_MIN_FRAMES
// A dip into the "neither" band (between the silence and speech floors) is
// tolerated up to DIGIT_VOICE_GAP_MS before the run resets (L4266-4274).
//
// NOTE ON SCOPE: the real gate's speechThr/silenceThr (vadSpeechThreshold) is a
// per-session, greeting-warmed calibration this harness has no way to derive from
// a synthetic fixture. This mirror reuses VOICED_RUN_SPEECH_RMS_FLOOR /
// VOICED_RUN_SILENCE_RMS_FLOOR (the mic-qualify gate's floors, same signal shape)
// as a stand-in — a documented simplification, not a byte-exact replica of the
// live calibration.

const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes } = require('../lib/source-anchor');

const src = readSrc(CEREMONY_SRC_PATH);

const DIGIT_VOICE_MIN_MS = constFromSource(src, 'DIGIT_VOICE_MIN_MS', CEREMONY_SRC_PATH);
const DIGIT_VOICE_GAP_MS = constFromSource(src, 'DIGIT_VOICE_GAP_MS', CEREMONY_SRC_PATH);
const VOICE_EVIDENCE_MIN_FRAMES = constFromSource(src, 'VOICE_EVIDENCE_MIN_FRAMES', CEREMONY_SRC_PATH);
const SPEECH_RMS_FLOOR = constFromSource(src, 'VOICED_RUN_SPEECH_RMS_FLOOR', CEREMONY_SRC_PATH);
const SILENCE_RMS_FLOOR = constFromSource(src, 'VOICED_RUN_SILENCE_RMS_FLOOR', CEREMONY_SRC_PATH);

function verifySource() {
    requireIncludes(src, '(_now - _voiceOnsetAt) >= DIGIT_VOICE_MIN_MS',
        'digit-voice mirror: DIGIT_VOICE_MIN_MS elapsed-check expression not found — source has diverged');
    requireIncludes(src, '(_vadStarved || (voiceMax - voiceMin) >= Math.max(0.012, 0.10 * voiceMax))',
        'digit-voice mirror: relative modulation-floor + _vadStarved-bypass expression not found — source has diverged');
    requireIncludes(src, '_voicedAboveThrFrames >= VOICE_EVIDENCE_MIN_FRAMES',
        'digit-voice mirror: VOICE_EVIDENCE_MIN_FRAMES gate not found — source has diverged');
}

// frames: [{ tMs, rms, vbRatio }] — a single run attempt, ascending tMs.
// vadStarved mirrors source's `(_vadStarved || (voiceMax - voiceMin) >= ...)` bypass (L4221/L4251) —
// an already-proven voiced path (starved-analyser spectral proxy) skips the modulation check. No
// current fixture simulates a starved analyser, so it defaults false.
function run(frames, vadStarved) {
    const t0 = process.hrtime.bigint();
    let onsetAt = null;
    let voiceMin = 1, voiceMax = 0;
    let framesAboveThr = 0;
    let dipStart = null;
    let fired = false;
    let firedAtMs = null;

    for (const f of frames) {
        const above = f.rms > SPEECH_RMS_FLOOR;
        const silent = f.rms < SILENCE_RMS_FLOOR;

        if (above) {
            if (onsetAt === null) { onsetAt = f.tMs; voiceMin = f.rms; voiceMax = f.rms; framesAboveThr = 0; }
            voiceMin = Math.min(voiceMin, f.rms);
            voiceMax = Math.max(voiceMax, f.rms);
            framesAboveThr++;
            dipStart = null;
        } else if (silent) {
            onsetAt = null; voiceMin = 1; voiceMax = 0; framesAboveThr = 0; dipStart = null;
        } else if (onsetAt !== null) {
            // "neither" band — tolerate a brief dip, kill the run past DIGIT_VOICE_GAP_MS.
            if (dipStart === null) dipStart = f.tMs;
            else if (f.tMs - dipStart > DIGIT_VOICE_GAP_MS) { onsetAt = null; voiceMin = 1; voiceMax = 0; framesAboveThr = 0; dipStart = null; }
        }

        if (onsetAt !== null && !fired) {
            const elapsed = f.tMs - onsetAt;
            const mod = voiceMax - voiceMin;
            if (elapsed >= DIGIT_VOICE_MIN_MS
                && (vadStarved || mod >= Math.max(0.012, 0.10 * voiceMax))
                && framesAboveThr >= VOICE_EVIDENCE_MIN_FRAMES) {
                fired = true;
                firedAtMs = f.tMs;
            }
        }
    }

    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        pass: fired,
        score: fired ? 1 : 0,
        latencyMs,
        detail: { firedAtMs, framesSeen: frames.length },
    };
}

module.exports = {
    name: 'digit_voice',
    verifySource,
    run,
    constants: { DIGIT_VOICE_MIN_MS, DIGIT_VOICE_GAP_MS, VOICE_EVIDENCE_MIN_FRAMES, SPEECH_RMS_FLOOR, SILENCE_RMS_FLOOR },
};
