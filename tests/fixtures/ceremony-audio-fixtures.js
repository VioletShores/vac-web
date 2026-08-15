'use strict';
// ceremony-audio-fixtures.js — F-1139 S164: synthetic audio fixture generator
//
// Generates (tdBuf, freqBuf) frame pairs for liveness gate scenarios WITHOUT committing
// any real-person audio. All signals are mathematically synthesized.
//
// Analyser parameters (matches vac-reauth-ceremony.js):
//   fftSize = 256 → frequencyBinCount = 128
//   sampleRate = 48000 Hz → bin_hz = 187.5 Hz/bin
//   Voice band bins: ceil(85*256/48000)=1 to floor(3000*256/48000)=16
//
// DESIGN DECISION (documented in F1139-HARNESS-DESIGN-S164.md):
//   Time-domain buffers use a constant-offset pattern for exact RMS control.
//   `sqrt(mean((buf[i]-128)^2)) / 128 = delta/128` exactly (no sinusoid phase ambiguity).
//   Frequency-domain buffers are constructed independently to set voice-band ratio.
//   The gate only reads RMS from tdBuf and vbRatio from freqBuf — decoupling is valid.

const FFT_SIZE = 256;
const FREQ_BINS = 128;     // frequencyBinCount = fftSize / 2
const SAMPLE_RATE = 48000;
const VOICE_BAND_START = Math.ceil(85 * FFT_SIZE / SAMPLE_RATE);    // = 1
const VOICE_BAND_END   = Math.floor(3000 * FFT_SIZE / SAMPLE_RATE); // = 16

// ── Exact-RMS buffer builders ─────────────────────────────────────────────────

// Time-domain buffer with exact computable RMS = delta/128.
// All samples = 128 + delta (constant offset). Signed delta for variety (alternates polarity).
// sqrt(mean((128+delta - 128)^2)) / 128 = |delta| / 128 = rmsValue exactly.
function makeTdBufRms(rmsValue) {
    const buf = new Uint8Array(FFT_SIZE).fill(128);
    if (rmsValue <= 0) return buf;
    const delta = Math.round(Math.min(127, rmsValue * 128));
    buf.fill(128 + delta);
    return buf;
}

// Frequency-domain buffer with specified voice-band level.
// voice-band bins (VOICE_BAND_START..VOICE_BAND_END): voiceBinVal
// all other bins: otherBinVal
function makeFreqBufVbr(voiceBinVal, otherBinVal) {
    const buf = new Uint8Array(FREQ_BINS).fill(Math.round(otherBinVal));
    for (let i = VOICE_BAND_START; i <= VOICE_BAND_END; i++) buf[i] = Math.round(voiceBinVal);
    return buf;
}

// ── Calculation mirrors (source-anchored — mirrors of source formulas) ──────

// Mirror of _computeRms from _phraseVadTick (must match the source formula):
function rmsOfTdBuf(tdBuf) {
    let s = 0;
    for (let i = 0; i < tdBuf.length; i++) { const d = tdBuf[i] - 128; s += d * d; }
    return Math.sqrt(s / tdBuf.length) / 128;
}

// Mirror of _voiceBandRatio from source (totSum starts at 1 — division guard):
function vbRatioOfFreqBuf(freqBuf) {
    let vbSum = 0, totSum = 1;
    for (let i = 0; i < freqBuf.length; i++) {
        totSum += freqBuf[i];
        if (i >= VOICE_BAND_START && i <= VOICE_BAND_END) vbSum += freqBuf[i];
    }
    return vbSum / totSum;
}

// ── Fixture constants ────────────────────────────────────────────────────────

// Phrase gate thresholds (mirrored from source for fixture calibration):
const VAD_SPEECH_RMS   = 0.055;   // VAD_SPEECH_RMS_FALLBACK — must exceed this for voiced tick
const VAD_SILENCE_RMS  = 0.030;   // VAD_SILENCE_RMS_FALLBACK — below this fires silence branch
const PHRASE_MOD_DELTA = 0.045;   // modulation floor for phraseHeardVoice

// RMS choices for each scenario:
//   HIGH:    0.117 (delta=15) — clearly voiced, far above threshold
//   MEDIUM:  0.070 (delta=9)  — voiced, above threshold, gives modulation with HIGH
//   LOW3M:   0.047 (delta=6)  — marginal (greeting at 3m)
//   CRUSH:   0.031 (delta=4)  — IOS_AMPLITUDE_CRUSH (dead zone: > VAD_SILENCE, < VAD_SPEECH)
//   TAP:     0.125 (delta=16) — single loud tap
//   HUM:     0.094 (delta=12) — sustained hum at high amplitude (hum is not voice-band)
//   TV:      0.055 (delta=7)  — background TV at borderline amplitude
//   SILENCE: 0.000 (delta=0)  — true silence

// Verify modulation: HIGH - MEDIUM = 0.117 - 0.070 = 0.047 >= PHRASE_MOD_DELTA (0.045) ✓
const RMS_HIGH   = 15 / 128;  // 0.1172
const RMS_MEDIUM = 9  / 128;  // 0.0703
const RMS_LOW3M  = 6  / 128;  // 0.0469 — below VAD_SPEECH (0.055) → marginal
const RMS_CRUSH  = 4  / 128;  // 0.0313 — IOS dead zone: >VAD_SILENCE(0.030), <VAD_SPEECH(0.055)
const RMS_TAP    = 16 / 128;  // 0.1250
const RMS_HUM    = 12 / 128;  // 0.0938
const RMS_TV     = 7  / 128;  // 0.0547 — near speech threshold
const RMS_SIL    = 0;

// Frequency buffers:
const FREQ_VOICE     = makeFreqBufVbr(80, 2);  // vbRatio ≈ 0.85 (strong voice band)
const FREQ_VOICE_MOD = makeFreqBufVbr(70, 2);  // vbRatio ≈ 0.82 (slight variation)
const FREQ_HUM       = makeFreqBufVbr(0, 1);   // vbRatio ≈ 0 (no voice-band energy)
                                                 // (60Hz hum = bin 0, excluded from voice band)
const FREQ_TV        = makeFreqBufVbr(5, 8);   // vbRatio ≈ 0.082 (broadband, low voice fraction)
const FREQ_SILENT    = new Uint8Array(FREQ_BINS).fill(0);

// ── Fixture factories ─────────────────────────────────────────────────────────

// F1: clean_greeting — clear near-field voice with speech modulation
//   Voiced segment (frames 0..N_VOICED-1): alternates HIGH/MEDIUM RMS with voice-band freq
//   HIGH:   RMS = 0.117 (> VAD_SPEECH 0.055) → voiced tick ✓
//   MEDIUM: RMS = 0.070 (> VAD_SPEECH 0.055) → voiced tick ✓
//   Modulation = HIGH - MEDIUM = 0.047 ≥ PHRASE_MOD_DELTA (0.045) ✓
//   Silence segment (frames N_VOICED..end): fires phraseSpoke after 2 ticks
// Expected: PHRASE_FIRES, MIC_GREENS
function cleanGreeting(nFrames) {
    // N_VOICED >= 35: EMA ramp takes ~4 frames before avVbEma >= 0.45, so sustain needs 4+25=29 frames minimum.
    // 35 gives avVbSustain=31 comfortably; phrase gate needs only 7 voiced ticks so extra frames are fine.
    const N_VOICED  = Math.min(35, Math.floor(nFrames * 0.6));
    const frames = [];
    for (let k = 0; k < nFrames; k++) {
        if (k < N_VOICED) {
            // Alternate between HIGH and MEDIUM for modulation spread
            const useHigh = (k % 2 === 0);
            frames.push({
                tdBuf:   makeTdBufRms(useHigh ? RMS_HIGH : RMS_MEDIUM),
                freqBuf: useHigh ? FREQ_VOICE : FREQ_VOICE_MOD,
            });
        } else {
            // Silence → phraseSpoke fires after PHRASE_SILENCE_TICKS_NEEDED = 2 silence ticks
            frames.push({ tdBuf: makeTdBufRms(RMS_SIL), freqBuf: FREQ_SILENT });
        }
    }
    return frames;
}

// F2: silence — near-zero output
// Expected: PHRASE_STUCK, MIC_RED
function silenceFixture(nFrames) {
    return Array.from({ length: nFrames }, () => ({
        tdBuf:   makeTdBufRms(RMS_SIL),
        freqBuf: FREQ_SILENT,
    }));
}

// F3: single_tap — one frame spike then silence
// 1 voiced tick << PHRASE_VOICED_TICKS_NEEDED (7) → gate stuck
// Expected: PHRASE_STUCK, MIC_RED (< 3 consecutive frames for amplitude qualify)
function singleTap(nFrames) {
    return Array.from({ length: nFrames }, (_, k) => {
        const isTap = (k === 5);
        return {
            tdBuf:   makeTdBufRms(isTap ? RMS_TAP : RMS_SIL),
            freqBuf: isTap ? FREQ_TV : FREQ_SILENT,  // tap: broadband, not voice-band-dominant
        };
    });
}

// F4: sustained_hum — 60Hz electrical hum (bin 0, outside voice band 1..16)
// vbRatio ≈ 0 → NOT in voiced branch (requires vbRatio >= 0.45)
// amplitude in "neither" band → gate holds at 0 ticks
// Seed mechanism: seededAmbient absorbs hum level → qualify floor rises above hum → MIC_RED
// Expected: PHRASE_STUCK, MIC behavior documented
function sustainedHum(nFrames) {
    return Array.from({ length: nFrames }, () => ({
        tdBuf:   makeTdBufRms(RMS_HUM),
        freqBuf: FREQ_HUM,
    }));
}

// F5: background_tv — broadband moderate noise
// vbRatio ≈ 0.16 < VOICE_BAND_MIN_RATIO (0.45) → not voiced
// RMS ≈ 0.055 (borderline) → either "neither" band or barely voiced amplitude
// Expected: PHRASE_STUCK
function backgroundTv(nFrames) {
    return Array.from({ length: nFrames }, () => ({
        tdBuf:   makeTdBufRms(RMS_TV),
        freqBuf: FREQ_TV,
    }));
}

// F6: second_speaker — voice-like signal from a different person (APCER scenario)
// RMS = 0.070 (above threshold), vbRatio ≈ 0.82 → qualifies as voiced
// Documents current gate behavior: second speaker's voice-energy passes liveness check.
// Server-side content verification (transcript match) is the authoritative security defense.
// Expected: DOCUMENTS_BEHAVIOR (gate may fire — records APCER exposure)
function secondSpeaker(nFrames) {
    const N_VOICED  = Math.min(35, Math.floor(nFrames * 0.6));
    return Array.from({ length: nFrames }, (_, k) => ({
        tdBuf:   makeTdBufRms(k < N_VOICED ? RMS_MEDIUM : RMS_SIL),
        freqBuf: k < N_VOICED ? FREQ_VOICE_MOD : FREQ_SILENT,
    }));
}

// F7: greeting_at_3m — attenuated signal (6-9dB vs near-field)
// RMS_LOW3M = 0.047 < VAD_SPEECH_RMS_FALLBACK (0.055) → RMS gate fails
// vbRatio = 0.82 (shape preserved) → spectral shape but no voiced tick without amplitude
// Expected: DOCUMENTS_BEHAVIOR (marginal — documents BPCER risk at 3m)
function greetingAt3m(nFrames) {
    const N_VOICED  = Math.min(35, Math.floor(nFrames * 0.6));
    return Array.from({ length: nFrames }, (_, k) => ({
        tdBuf:   makeTdBufRms(k < N_VOICED ? RMS_LOW3M : RMS_SIL),
        freqBuf: k < N_VOICED ? FREQ_VOICE : FREQ_SILENT,
    }));
}

// F8: IOS_AMPLITUDE_CRUSH — PRIORITY (replicates Rob 7:50 screenshot, S164 priority bug)
//
// iOS WebKit returns getByteTimeDomainData with ~3% RMS during live speech.
// The voice-band spectral shape IS preserved (iOS shows vbRatio ~0.85 via frequency domain).
//
// RMS = 4/128 = 0.031 — falls in the dead zone:
//   > VAD_SILENCE_RMS_FALLBACK (0.030) → NOT in silence branch (ticks don't decay)
//   < VAD_SPEECH_RMS_FALLBACK  (0.055) → NOT in voiced branch (ticks don't accumulate)
//   = NEITHER BAND → gate holds at 0 ticks forever
//
// _vadStarved accumulator: requires _rms < 0.02 to increment. At 0.031 > 0.02 → starvation
// counter never increments → _vadStarved stays false → spectral escape path inactive.
//
// Result: phraseVoicedTicks stays 0 forever → greeting stuck indefinitely.
// THIS IS THE BUG. Fix is in the NEXT lane.
// Expected test outcome: PHRASE_STUCK (current FAIL = bug reproduced)
function iosAmplitudeCrush(nFrames) {
    return Array.from({ length: nFrames }, () => ({
        tdBuf:   makeTdBufRms(RMS_CRUSH),  // 0.031: dead zone confirmed
        freqBuf: FREQ_VOICE,               // voice-band healthy: vbRatio ≈ 0.85
    }));
}

// ── Utility ───────────────────────────────────────────────────────────────────

function annotate(name, frames, expectedOutcome) {
    const first = frames[0];
    return {
        name,
        expectedOutcome,
        rms:      parseFloat(rmsOfTdBuf(first.tdBuf).toFixed(4)),
        vbRatio:  parseFloat(vbRatioOfFreqBuf(first.freqBuf).toFixed(4)),
        frames,
        nFrames:  frames.length,
    };
}

// ── Exported fixtures ─────────────────────────────────────────────────────────

const N_PHRASE_TICKS = 50;
const N_MIC_FRAMES   = 120;

module.exports = {
    FFT_SIZE, FREQ_BINS, SAMPLE_RATE, VOICE_BAND_START, VOICE_BAND_END,
    rmsOfTdBuf, vbRatioOfFreqBuf,
    // RMS constants exposed for test assertions
    VAD_SPEECH_RMS, VAD_SILENCE_RMS,
    RMS_HIGH, RMS_MEDIUM, RMS_LOW3M, RMS_CRUSH, RMS_TAP, RMS_HUM, RMS_TV, RMS_SIL,

    FIXTURES: {
        clean_greeting:       annotate('clean_greeting',     cleanGreeting(N_PHRASE_TICKS),    'PHRASE_FIRES'),
        silence:              annotate('silence',             silenceFixture(N_PHRASE_TICKS),   'PHRASE_STUCK'),
        single_tap:           annotate('single_tap',          singleTap(N_PHRASE_TICKS),        'PHRASE_STUCK'),
        sustained_hum:        annotate('sustained_hum',       sustainedHum(N_PHRASE_TICKS),     'PHRASE_STUCK'),
        background_tv:        annotate('background_tv',       backgroundTv(N_PHRASE_TICKS),     'PHRASE_STUCK'),
        second_speaker:       annotate('second_speaker',      secondSpeaker(N_PHRASE_TICKS),    'DOCUMENTS_BEHAVIOR'),
        greeting_at_3m:       annotate('greeting_at_3m',      greetingAt3m(N_PHRASE_TICKS),     'DOCUMENTS_BEHAVIOR'),
        IOS_AMPLITUDE_CRUSH:  annotate('IOS_AMPLITUDE_CRUSH', iosAmplitudeCrush(N_PHRASE_TICKS),'PHRASE_STUCK'),
    },

    MIC_FIXTURES: {
        clean_greeting:       annotate('clean_greeting',     cleanGreeting(N_MIC_FRAMES),   'MIC_GREENS'),
        silence:              annotate('silence',             silenceFixture(N_MIC_FRAMES),  'MIC_RED'),
        single_tap:           annotate('single_tap',          singleTap(N_MIC_FRAMES),       'MIC_RED'),
        sustained_hum:        annotate('sustained_hum',       sustainedHum(N_MIC_FRAMES),    'DOCUMENTS_BEHAVIOR'),
        background_tv:        annotate('background_tv',       backgroundTv(N_MIC_FRAMES),    'DOCUMENTS_BEHAVIOR'),
        IOS_AMPLITUDE_CRUSH:  annotate('IOS_AMPLITUDE_CRUSH', iosAmplitudeCrush(N_MIC_FRAMES),'DOCUMENTS_BEHAVIOR'),
    },
};
