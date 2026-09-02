'use strict';
// mic-starved-analyser-fixtures.js — s182 ceremony UX bundle (CEREMONY-MIC-DIAGNOSIS-2026-08-20 §4a)
//
// The diagnosis names the missing specimen: "a starved-analyser fixture — a synthetic or captured
// stream that reproduces analyser_starved_mr_fallback, because that is the actual defect and no
// existing fixture triggers it." This file is that fixture. No real-person audio: every signal is
// math, in the same (tdBuf, freqBuf) frame-pair shape tests/fixtures/mic-test-audio-fixtures.js uses,
// plus a MediaRecorder chunk-size series (the OS-path proxy the fallback reads).
//
// The defect, as the telemetry recorded it (21x analyser_starved_mr_fallback in four minutes):
//   AudioContext.state === 'running', analyser peak level <= 1%, time-domain RMS ~0.004 (codec noise),
//   FFT mean bin < 3 (quantisation noise -> voice-band ratio is NEUTRAL, -1) — while the
//   MediaRecorder on the SAME track encodes real speech (chunk sizes modulate 1.5-3x).

const FFT_SIZE = 256;
const FREQ_BINS = 128;
const FRAME_MS = 1000 / 60;         // runAVFrame runs per rAF frame
const MR_CHUNK_MS = 200;            // _startAvMrFallback: _fbMr.start(200)

// A starved analyser frame: 1-count wobble around 128 (peak level round(1/128*100) = 1%,
// RMS ~0.004), spectrum energy ~1/255 per bin (mean bin < 3 -> ratio neutral).
function starvedFrame(i) {
    const td = new Uint8Array(FFT_SIZE).fill(128);
    for (let k = 0; k < FFT_SIZE; k += 7) td[k] = 128 + ((i + k) % 2 ? 1 : -1);
    const fq = new Uint8Array(FREQ_BINS).fill(1);
    return { tdBuf: td, freqBuf: fq };
}

// Chunk-size series, one entry per 200ms MediaRecorder slice.
// Speech: phoneme-boundary amplitude variance -> sizes swing ~1.4-3.1 KB (ratio ~2.2 -> level ~40).
const MR_SPEECH_CHUNKS = [1500, 1420, 2650, 1900, 3100, 1550, 2800, 2100, 1450, 2950, 1700, 2600, 1500, 3050, 1800, 2400, 1600, 2900, 2000, 2700];
// Silence: opus encodes near-constant tiny frames (ratio ~1.01 -> level 0).
const MR_SILENCE_CHUNKS = [900, 905, 898, 902, 901, 899, 903, 900, 904, 897, 902, 900, 901, 899, 903, 900, 902, 898, 901, 900];
// A single transient (door slam) then silence: one big slice, then flat.
const MR_DOOR_SLAM_CHUNKS = [900, 3600, 905, 899, 902, 900, 901, 898, 903, 900, 902, 899, 901, 900, 903, 898, 902, 900, 901, 899];

// A cold-start iOS run: context created in the tap at 48000 Hz, the mic open switched the
// hardware route to 44100 Hz — the rate mismatch the s182 rebuild targets.
const RATE_MISMATCH = { ctxSampleRate: 48000, trackSampleRate: 44100 };
const RATE_MATCH    = { ctxSampleRate: 48000, trackSampleRate: 48000 };

const STARVED_FIXTURES = {
    starved_then_speech: {
        name: 'starved_then_speech',
        expectedOutcome: 'fallback qualifies (path mr)',
        seconds: 8,
        frame: starvedFrame,
        mrChunks: MR_SPEECH_CHUNKS,
        mrStartsAfterMs: 2000,   // the proxy only exists once starvation is confirmed (2s)
    },
    starved_silence: {
        name: 'starved_silence',
        expectedOutcome: 'never qualifies',
        seconds: 8,
        frame: starvedFrame,
        mrChunks: MR_SILENCE_CHUNKS,
        mrStartsAfterMs: 2000,
    },
    starved_door_slam: {
        name: 'starved_door_slam',
        expectedOutcome: 'documented property: a transient can qualify the DEGRADED path (tagged mr, narrated)',
        seconds: 8,
        frame: starvedFrame,
        mrChunks: MR_DOOR_SLAM_CHUNKS,
        mrStartsAfterMs: 2000,
    },
};

module.exports = {
    FFT_SIZE, FREQ_BINS, FRAME_MS, MR_CHUNK_MS,
    starvedFrame, MR_SPEECH_CHUNKS, MR_SILENCE_CHUNKS, MR_DOOR_SLAM_CHUNKS,
    RATE_MISMATCH, RATE_MATCH, STARVED_FIXTURES,
};
