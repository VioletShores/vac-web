'use strict';
// mic-test-audio-fixtures.js — S166 task-mictest-voiced-only step 4/5
//
// Synthetic (tdBuf, freqBuf) frame-pair fixtures for the preflight "Mic: working" check
// (runAVFrame's mic-qualify block in vac-reauth-ceremony.js), covering the scenarios named in
// D-MICTEST-GREENS-ON-NOISE (L-2503/L-2504): silence, a door slam, far-field TV speech, and
// near-field real speech. No real-person audio is used anywhere — every signal is math.
//
// PATTERN: follows tests/fixtures/ceremony-audio-fixtures.js (task-f1139-ceremony-harness @f662285)
// — exact-RMS constant-offset time-domain buffers + independently-controlled frequency-domain
// buffers for voice-band ratio. Kept as a separate file (distinct scenario set, distinct scope:
// the mic-qualify gate only, not the full 8-scenario phrase-gate harness) to avoid colliding with
// that file if/when task-f1139-ceremony-harness merges.
//
// Analyser parameters (matches vac-reauth-ceremony.js):
//   fftSize = 256 -> frequencyBinCount = 128
//   sampleRate = 48000 Hz -> bin_hz = 187.5 Hz/bin
//   Voice band bins: ceil(85*256/48000)=1 to floor(3000*256/48000)=16

const FFT_SIZE = 256;
const FREQ_BINS = 128;
const SAMPLE_RATE = 48000;
const VOICE_BAND_START = Math.ceil(85 * FFT_SIZE / SAMPLE_RATE);    // = 1
const VOICE_BAND_END   = Math.floor(3000 * FFT_SIZE / SAMPLE_RATE); // = 16

// ── Exact-RMS / exact-vbRatio buffer builders (identical technique to ceremony-audio-fixtures.js) ──

function makeTdBufRms(rmsValue) {
    const buf = new Uint8Array(FFT_SIZE).fill(128);
    if (rmsValue <= 0) return buf;
    const delta = Math.round(Math.min(127, rmsValue * 128));
    buf.fill(128 + delta);
    return buf;
}

function makeFreqBufVbr(voiceBinVal, otherBinVal) {
    const buf = new Uint8Array(FREQ_BINS).fill(Math.round(otherBinVal));
    for (let i = VOICE_BAND_START; i <= VOICE_BAND_END; i++) buf[i] = Math.round(voiceBinVal);
    return buf;
}

// Mirrors of the source formulas (used by tests to annotate/verify fixtures):
function rmsOfTdBuf(tdBuf) {
    let s = 0;
    for (let i = 0; i < tdBuf.length; i++) { const d = tdBuf[i] - 128; s += d * d; }
    return Math.sqrt(s / tdBuf.length) / 128;
}
function vbRatioOfFreqBuf(freqBuf) {
    let vbSum = 0, totSum = 1;
    for (let i = 0; i < freqBuf.length; i++) {
        totSum += freqBuf[i];
        if (i >= VOICE_BAND_START && i <= VOICE_BAND_END) vbSum += freqBuf[i];
    }
    return vbSum / totSum;
}

// ── Fixture constants (mirrored from vac-reauth-ceremony.js's shared voiced-run predicate) ────
const VOICED_RUN_SPEECH_RMS_FLOOR  = 0.055;  // VOICED_RUN_SPEECH_RMS_FLOOR — near-field amplitude gate
const VOICED_RUN_SILENCE_RMS_FLOOR = 0.030;  // VOICED_RUN_SILENCE_RMS_FLOOR — below this decays the run
const VOICE_BAND_MIN_RATIO         = 0.45;   // voice-band-dominance gate
const VOICED_RUN_MOD_DELTA         = 0.045;  // modulation floor (rejects a flat tone/hum/steady TV bed)

// RMS choices:
const RMS_NEAR_HIGH = 15 / 128;  // 0.1172 — near-field speech, loud syllable
const RMS_NEAR_MED  = 9  / 128;  // 0.0703 — near-field speech, quieter syllable (gives modulation)
const RMS_FAR_TV    = 6  / 128;  // 0.0469 — far-field TV: above silence floor, below speech floor (the "neither" band)
const RMS_DOOR_SLAM = 18 / 128;  // 0.1406 — one loud transient
const RMS_SIL       = 0;

// Verify near-field modulation clears the anti-hum floor:
// RMS_NEAR_HIGH - RMS_NEAR_MED = 0.1172 - 0.0703 = 0.0469 >= VOICED_RUN_MOD_DELTA (0.045) OK

// Frequency buffers:
const FREQ_VOICE_A = makeFreqBufVbr(80, 2);  // vbRatio ~0.85 — strong voice-band shape
const FREQ_VOICE_B = makeFreqBufVbr(70, 2);  // vbRatio ~0.82 — slight variant (real speech isn't static)
const FREQ_DOOR    = makeFreqBufVbr(5, 8);   // vbRatio ~0.082 — broadband physical impact, not voice-shaped
const FREQ_SILENT  = new Uint8Array(FREQ_BINS).fill(0);

// ── Fixture factories ───────────────────────────────────────────────────────

// F1: silence — true near-zero input the whole window.
// Expected: MIC_STUCK (never a voiced frame, never accumulates ticks)
function silence(nFrames) {
    return Array.from({ length: nFrames }, () => ({ tdBuf: makeTdBufRms(RMS_SIL), freqBuf: FREQ_SILENT }));
}

// F2: door_slam — one loud, broadband (non-voice-band) transient, then silence.
// vbRatio ~0.082 < VOICE_BAND_MIN_RATIO (0.45) -> never a voiced frame even during the spike;
// and even if it were, 1 frame << VOICED_RUN_TICKS_NEEDED (7).
// Expected: MIC_STUCK
function doorSlam(nFrames) {
    return Array.from({ length: nFrames }, (_, k) => {
        const isSlam = (k === 5);
        return {
            tdBuf:   makeTdBufRms(isSlam ? RMS_DOOR_SLAM : RMS_SIL),
            freqBuf: isSlam ? FREQ_DOOR : FREQ_SILENT,
        };
    });
}

// F3: far_field_tv_speech — a TV playing real dialogue (voice-band shape intact, vbRatio ~0.85)
// but from across the room: RMS = 0.047, in the dead zone between the silence floor (0.030) and
// the speech floor (0.055). Neither voiced nor silence -> ticks HOLD at 0 forever. This is the
// scenario the near-field amplitude gate exists to reject (spectral shape alone isn't enough).
// Expected: MIC_STUCK
function farFieldTvSpeech(nFrames) {
    return Array.from({ length: nFrames }, (_, k) => ({
        tdBuf:   makeTdBufRms(RMS_FAR_TV),
        freqBuf: (k % 2 === 0) ? FREQ_VOICE_A : FREQ_VOICE_B,
    }));
}

// F4: near_field_real_speech — sustained, modulated, voice-band-dominant utterance close to the mic.
// Alternates HIGH/MEDIUM RMS (both > speech floor) with voice-band frequency content; modulation
// (0.047) clears VOICED_RUN_MOD_DELTA (0.045); >=7 consecutive voiced ticks accumulate.
// Expected: MIC_GREENS — the ONLY fixture in this set that should.
function nearFieldRealSpeech(nFrames) {
    const N_VOICED = Math.min(40, Math.floor(nFrames * 0.6));
    return Array.from({ length: nFrames }, (_, k) => {
        if (k < N_VOICED) {
            const useHigh = (k % 2 === 0);
            return {
                tdBuf:   makeTdBufRms(useHigh ? RMS_NEAR_HIGH : RMS_NEAR_MED),
                freqBuf: useHigh ? FREQ_VOICE_A : FREQ_VOICE_B,
            };
        }
        return { tdBuf: makeTdBufRms(RMS_SIL), freqBuf: FREQ_SILENT };
    });
}

function annotate(name, frames, expectedOutcome) {
    const first = frames[0];
    return {
        name,
        expectedOutcome,
        rms:     parseFloat(rmsOfTdBuf(first.tdBuf).toFixed(4)),
        vbRatio: parseFloat(vbRatioOfFreqBuf(first.freqBuf).toFixed(4)),
        frames,
        nFrames: frames.length,
    };
}

const N_MIC_FRAMES = 120;

module.exports = {
    FFT_SIZE, FREQ_BINS, SAMPLE_RATE, VOICE_BAND_START, VOICE_BAND_END,
    rmsOfTdBuf, vbRatioOfFreqBuf, makeTdBufRms, makeFreqBufVbr,
    VOICED_RUN_SPEECH_RMS_FLOOR, VOICED_RUN_SILENCE_RMS_FLOOR, VOICE_BAND_MIN_RATIO, VOICED_RUN_MOD_DELTA,
    RMS_NEAR_HIGH, RMS_NEAR_MED, RMS_FAR_TV, RMS_DOOR_SLAM, RMS_SIL,

    MIC_FIXTURES: {
        silence:              annotate('silence',              silence(N_MIC_FRAMES),              'MIC_STUCK'),
        door_slam:            annotate('door_slam',             doorSlam(N_MIC_FRAMES),             'MIC_STUCK'),
        far_field_tv_speech:  annotate('far_field_tv_speech',   farFieldTvSpeech(N_MIC_FRAMES),     'MIC_STUCK'),
        near_field_real_speech: annotate('near_field_real_speech', nearFieldRealSpeech(N_MIC_FRAMES), 'MIC_GREENS'),
    },
};
