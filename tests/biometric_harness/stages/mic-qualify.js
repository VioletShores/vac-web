'use strict';
// Execute the shipped tracker and preflight classifier, with synthetic audio.
// No browser/recorder/provider or server identity verdict is exercised here.
const vm = require('node:vm');
const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes, functionFromSource, declarationFromSource } = require('../lib/source-anchor');
const src = readSrc(CEREMONY_SRC_PATH);
const names = ['VOICED_RUN_TICKS_NEEDED', 'MIC_PREFLIGHT_TICKS_NEEDED', 'VOICED_RUN_MOD_DELTA', 'VOICED_RUN_SPEECH_RMS_FLOOR', 'VOICED_RUN_SILENCE_RMS_FLOOR', 'VOICE_BAND_MIN_RATIO', 'VOICE_BAND_STRONG_RATIO', 'MR_FALLBACK_VOICED_LEVEL'];
const constants = Object.fromEntries(names.map(n => [n, constFromSource(src, n)]));
function trackerSource(source) {
    return names.map(n => declarationFromSource(source, n, 0)).join('\n') + '\n' +
        ['_newVoicedRunState', '_voicedRunTick', '_voicedRunPass'].map(n => functionFromSource(source, n)).join('\n');
}
function compile(source = src) {
    requireIncludes(source, '_micVoicedState = _newVoicedRunState(MIC_PREFLIGHT_TICKS_NEEDED);');
    const tick = '_voicedRunTick(_micVoicedState, _mrVoicedFrame ? (_avMrLevelSynth / 100) : _ceremonyRms, _micVoicedFrame, _micSilenceFrame);';
    requireIncludes(source, tick);
    requireIncludes(source, 'if (_micSeeded && _voicedRunPass(_micVoicedState, _micOnFallback))');
    if ((source.match(/avChecks\.mic\s*=\s*true/g) || []).length !== 1) throw new Error('expected one mic success assignment');
    const signalStart = '            let _speechRatio = 0;';
    const signalEnd = '            _ceremonyRms = Math.sqrt(_ceremonyRms / dataArray.length) / 128;';
    if (source.split(signalStart).length !== 2 || source.split(signalEnd).length !== 2) throw new Error('ambiguous mic signal extraction');
    const start = source.indexOf(signalStart), end = source.indexOf(signalEnd);
    if (end <= start) throw new Error('invalid mic signal extraction order');
    const signal = source.slice(start, end + signalEnd.length);
    return vm.runInNewContext(trackerSource(source) + `\n({
        newState: _newVoicedRunState, tick: _voicedRunTick, pass: _voicedRunPass,
        preflightState: () => _newVoicedRunState(MIC_PREFLIGHT_TICKS_NEEDED),
        frame: function(_micVoicedState, dataArray, _fbuf, _micOnFallback, _avMrLevelSynth, _micSeeded) {
            ${signal}
            ${['_mrVoicedFrame', '_micVoicedFrame', '_micSilenceFrame'].map(n => declarationFromSource(source, n)).join('\n')}
            ${tick}
            return _micSeeded && _voicedRunPass(_micVoicedState, _micOnFallback);
        }
    })`);
}
function verifySource() { compile(); }
const tracker = compile();
function run(frames, options = {}) {
    // Old boolean override was not a real preflight context. Never bypass modulation
    // without explicitly exercising the recorder-fallback classifier.
    if (typeof options !== 'object' || options === null) throw new Error('mic requires explicit context options');
    const t0 = process.hrtime.bigint(), gate = compile(), state = gate.preflightState();
    let passedAtFrame = null;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (gate.frame(state, f.tdBuf, f.freqBuf, !!options.fallback, f.recorderLevel || 0, options.seeded !== false)) { passedAtFrame = i; break; }
    }
    const pass = passedAtFrame !== null;
    return { pass, score: pass ? 1 : 0, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6,
        detail: { passedAtFrame, finalTicks: state.ticks, finalMod: +(state.max - state.min).toFixed(4) } };
}
module.exports = { name: 'mic_qualify', verifySource, run, compile, trackerSource, constants,
    newVoicedRunState: tracker.newState, voicedRunTick: tracker.tick, voicedRunPass: tracker.pass };
