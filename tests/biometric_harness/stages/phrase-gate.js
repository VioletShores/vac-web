'use strict';
// Run the complete shipped phrase tick and shared tracker. Only its surrounding
// browser/audio I/O is simulated; this is not a server biometric verdict or PID test.
const vm = require('node:vm');
const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes, functionFromSource, declarationFromSource } = require('../lib/source-anchor');
const mic = require('./mic-qualify');
const src = readSrc(CEREMONY_SRC_PATH);
function compile(source = src, options = {}) {
    requireIncludes(source, '_phraseVoicedState = _newVoicedRunState();');
    // The phrase closure has its own voice-band constant. Refuse scope drift
    // rather than silently substituting the global preflight threshold.
    if (constFromSource(declarationFromSource(source, 'VOICE_BAND_MIN_RATIO', 4, 'const'), 'VOICE_BAND_MIN_RATIO') !==
        constFromSource(declarationFromSource(source, 'VOICE_BAND_MIN_RATIO', 0), 'VOICE_BAND_MIN_RATIO')) {
        throw new Error('phrase/global voice-band scope divergence');
    }
    const noop = () => {};
    const c = { window: {}, document: { querySelector: () => null }, vacDebug: noop, _micPillDraw: noop,
        _showNoMicRecovery: noop, _startAvMrFallback: noop, _finalizeCalibration: noop,
        _reportLoopError: (where, err) => { throw new Error(where + ': ' + err.message); },
        phraseSpoke: false, _phraseHeardVoice: false, _phraseContentMatched: false,
        _phraseAnalyserFrames: 0, _hbRmsMax: 0, _calIsFallback: options.calibrated !== true,
        vadSpeechThreshold: options.threshold ?? mic.constants.VOICED_RUN_SPEECH_RMS_FLOOR,
        audioNoiseFloor: options.noiseFloor ?? 0.01, _floorSamples: [], _speechSamples: [],
        _phraseSilentRun: 0, fingerFallback: 'voice', _vadStarvedRun: 0, _vadStarved: false,
        _avMrFallback: true, _avMrLevelSynth: 0, _phraseHasTranscript: false,
        _sessionGateAvail: false, _phraseContentGate: null, _phraseSilenceTicks: 0 };
    vm.createContext(c);
    const declarations = ['VAD_SPEECH_RMS_FALLBACK', 'VAD_SILENCE_RMS_FALLBACK', '_CAL_FLOOR_MAX', '_CAL_SPEECH_MAX', 'SILENT_RECOVERY_TICKS', 'PHRASE_VOICED_TICKS_NEEDED', 'PHRASE_SILENCE_TICKS_NEEDED'];
    vm.runInContext(mic.trackerSource(source) + '\n' + declarations.map(n => declarationFromSource(source, n)).join('\n') + '\n' +
        functionFromSource(source, '_voiceBandRatio') + '\n' + functionFromSource(source, '_phraseVadTick') +
        '\nvar _phraseVoicedState = _newVoicedRunState();', c);
    return c;
}
function verifySource() { compile(); }
function run(frames, options = {}) {
    if (typeof options !== 'object' || options === null) throw new Error('phrase requires explicit context options');
    const t0 = process.hrtime.bigint(), c = compile(src, options);
    let passedAtFrame = null;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        c.audioAnalyser = { frequencyBinCount: f.freqBuf.length, fftSize: f.tdBuf.length, context: { sampleRate: 48000 },
            getByteTimeDomainData: b => b.set(f.tdBuf), getByteFrequencyData: b => b.set(f.freqBuf) };
        c._avMrLevelSynth = f.recorderLevel || 0;
        c._phraseVadTick();
        if (c._phraseHeardVoice && passedAtFrame === null) passedAtFrame = i;
    }
    const state = c._phraseVoicedState, pass = c._phraseHeardVoice;
    return { pass, score: pass ? 1 : 0, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6,
        detail: { passedAtFrame, finalTicks: state.ticks, finalMod: +(state.max - state.min).toFixed(4), utteranceComplete: c.phraseSpoke, starved: c._vadStarved } };
}
module.exports = { name: 'phrase_gate', verifySource, run, compile, get constants() { return { PHRASE_SILENCE_TICKS_NEEDED: constFromSource(src, 'PHRASE_SILENCE_TICKS_NEEDED') }; } };
