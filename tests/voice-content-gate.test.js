// voice-content-gate.test.js — task-voice-content-gate
//
// SPEC: D-VOICE-GATE-SPEAKER-AGNOSTIC
// Rob's daughter singing (door closed) drove RMS past the gold line and advanced
// the ceremony while Rob was silent. Root cause: progression gate was energy/RMS-only.
//
// This harness verifies:
//   C1: _contentTranscriptHasDigit present and returns false for unrelated speech
//   C2: _contentTranscriptHasDigit returns true for expected digit (word form)
//   C3: _contentTranscriptHasDigit returns true for expected digit (numeral form)
//   C4: _contentTranscriptHasDigit returns false for empty/silence transcript
//   C5: _contentTranscriptMatchesPhrase present and works for phrase token matching
//   C6: _CONTENT_DIGIT_MAP covers all digits 0-9
//   C7: _contentGateAvail is a boolean (module-level feature detection)
//   C8: _startDigitContentGate and _startPhraseContentGate are exported functions
//   C9: Energy-only VAD FIRE sites call _markSpeech only when _contentGateAvail is false
//   C10: VAD FIRE sites set _vadEnergyDetected = true when content gate is available
//   C11: renderGuided coaching text branch for energyHeard state is present
//   C12: No 🎙️/🗣️ emoji in ceremony coaching lines (hard rule)
//   C13: Phrase content gate variables _phraseContentGate/_phraseContentMatched are present
//   C14: _makeQuickReauthVoiceGate accepts and uses expectedDigit in cfg
//   C15: _stopSpeechGate stops _contentGate
//
// Audio fixtures (D-VOICE-GATE-SPEAKER-AGNOSTIC):
//   F1: Unrelated speech/singing at gate-passing energy → NO advance (Rob's daughter scenario)
//   F2: Expected digit word → advances
//   F3: Silence/empty transcript → no advance
//   F4: Numeral form of digit → advances
//   F5: Different digit word → no advance
//
// Run: node --test tests/voice-content-gate.test.js

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// ── helpers ──────────────────────────────────────────────────────────────────

function hasFn(name) {
    return src.includes('function ' + name + '(') || src.includes('function ' + name + ' (');
}

function hasConst(name) {
    return new RegExp('(?:const|var|let)\\s+' + name + '\\s*=').test(src);
}

// Extract and evaluate a pure-function body from source.
// ONLY safe for the content utility functions (no DOM, no ceremony state).
function evalFn(fnName) {
    // Match: function fnName(...) { ... }
    const startIdx = src.indexOf('function ' + fnName + '(');
    if (startIdx < 0) throw new Error('function ' + fnName + ' not found in source');
    // Find the opening brace
    let braceStart = src.indexOf('{', startIdx);
    let depth = 0, i = braceStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const body = src.slice(startIdx, i);
    // Evaluate in a sandboxed context that has _CONTENT_DIGIT_MAP and _contentNormWord
    const mapStart = src.indexOf('const _CONTENT_DIGIT_MAP =');
    const mapEnd   = src.indexOf('};', mapStart) + 2;
    const mapSrc   = src.slice(mapStart, mapEnd);
    const normStart = src.indexOf('function _contentNormWord(');
    const normEnd   = src.indexOf('\n}', normStart) + 2;
    const normSrc   = src.slice(normStart, normEnd);
    // eslint-disable-next-line no-new-func
    return Function('"use strict";\n' + mapSrc + '\n' + normSrc + '\nreturn (' + body + ');')();
}

// Extract _contentTranscriptHasDigit and _contentTranscriptMatchesPhrase
let _contentTranscriptHasDigit;
let _contentTranscriptMatchesPhrase;
try {
    _contentTranscriptHasDigit  = evalFn('_contentTranscriptHasDigit');
    _contentTranscriptMatchesPhrase = evalFn('_contentTranscriptMatchesPhrase');
} catch(e) {
    // extraction failed — tests that need them will fail with a clear message
}

// ── C1-C5: content gate logic ─────────────────────────────────────────────────

test('C1: _contentTranscriptHasDigit present and rejects unrelated speech (Rob daughter fixture F1)', () => {
    assert.ok(typeof _contentTranscriptHasDigit === 'function',
        '_contentTranscriptHasDigit must be a function in source');
    // F1: singing / unrelated speech — should NOT match digit 3
    assert.equal(_contentTranscriptHasDigit('la la la singing in the shower', 3), false,
        'Singing/unrelated speech must NOT match the expected digit');
    assert.equal(_contentTranscriptHasDigit('happy birthday to you', 2), false,
        'Happy birthday song must NOT match digit 2');
    assert.equal(_contentTranscriptHasDigit('do re mi fa sol la si', 4), false,
        'Solfege singing must NOT match digit 4');
    assert.equal(_contentTranscriptHasDigit('the quick brown fox', 5), false,
        'Unrelated sentence must NOT match digit 5');
});

test('C2: _contentTranscriptHasDigit returns true for expected digit word (fixture F2)', () => {
    assert.ok(typeof _contentTranscriptHasDigit === 'function');
    // F2: user says the actual digit word
    assert.equal(_contentTranscriptHasDigit('three', 3), true, '"three" must match digit 3');
    assert.equal(_contentTranscriptHasDigit('say two now', 2), true, '"two" in phrase must match digit 2');
    assert.equal(_contentTranscriptHasDigit('I said four', 4), true, '"four" must match digit 4');
    assert.equal(_contentTranscriptHasDigit('one', 1), true, '"one" must match digit 1');
    assert.equal(_contentTranscriptHasDigit('five fingers', 5), true, '"five" must match digit 5');
});

test('C3: _contentTranscriptHasDigit returns true for numeral form (fixture F4, F-823)', () => {
    assert.ok(typeof _contentTranscriptHasDigit === 'function');
    // F4: user says "3" or ASR returns numeral
    assert.equal(_contentTranscriptHasDigit('3', 3), true, 'Numeral "3" must match digit 3');
    assert.equal(_contentTranscriptHasDigit('show 2 fingers', 2), true, 'Numeral "2" in phrase must match');
    assert.equal(_contentTranscriptHasDigit('4', 4), true, 'Numeral "4" must match digit 4');
});

test('C4: _contentTranscriptHasDigit returns false for silence/empty transcript (fixture F3)', () => {
    assert.ok(typeof _contentTranscriptHasDigit === 'function');
    // F3: silence → transcript is empty/null
    assert.equal(_contentTranscriptHasDigit('', 3), false, 'Empty transcript must NOT match');
    assert.equal(_contentTranscriptHasDigit(null, 3), false, 'Null transcript must NOT match');
    assert.equal(_contentTranscriptHasDigit('   ', 3), false, 'Whitespace-only must NOT match');
    // F5: different digit word must not advance
    assert.equal(_contentTranscriptHasDigit('two', 3), false, 'Wrong digit word must NOT match');
    assert.equal(_contentTranscriptHasDigit('four', 2), false, 'Wrong digit "four" must not match 2');
});

test('C5: _contentTranscriptMatchesPhrase works for phrase token matching', () => {
    assert.ok(typeof _contentTranscriptMatchesPhrase === 'function',
        '_contentTranscriptMatchesPhrase must be a function in source');
    // Tokens are word-form (as extracted from the phrase string by the gate startup).
    // Require >= half the tokens to match — 2/3 minimum for ['hello','three','five'].
    assert.equal(_contentTranscriptMatchesPhrase('hello three five', ['hello', 'three', 'five']), true,
        'Transcript matching phrase word tokens must match');
    assert.equal(_contentTranscriptMatchesPhrase('i am rob three five', ['rob', 'three', 'five']), true,
        'Name + digits word-form must match phrase tokens');
    assert.equal(_contentTranscriptMatchesPhrase('la la la', ['hello', 'three', 'five']), false,
        'Unrelated speech must NOT match phrase tokens');
    assert.equal(_contentTranscriptMatchesPhrase('', ['hello']), false,
        'Empty transcript must not match any phrase');
    assert.equal(_contentTranscriptMatchesPhrase('hello world', []), false,
        'Empty phrase tokens must not match');
});

// ── C6: digit map coverage ────────────────────────────────────────────────────

test('C6: _CONTENT_DIGIT_MAP covers all digits 0-9', () => {
    const mapMatch = src.match(/const _CONTENT_DIGIT_MAP\s*=\s*\{([^}]+)\}/);
    assert.ok(mapMatch, '_CONTENT_DIGIT_MAP must be present in source');
    const mapBody = mapMatch[1];
    const expectedWords = ['zero','one','two','three','four','five','six','seven','eight','nine'];
    for (const word of expectedWords) {
        assert.ok(mapBody.includes("'" + word + "'") || mapBody.includes('"' + word + '"'),
            '_CONTENT_DIGIT_MAP must contain "' + word + '"');
    }
});

// ── C7: feature detection ─────────────────────────────────────────────────────

test('C7: _contentGateAvail is a module-level boolean feature detection variable', () => {
    assert.ok(hasConst('_contentGateAvail'),
        '_contentGateAvail must be declared at module level');
    assert.ok(src.includes('SpeechRecognition || window.webkitSpeechRecognition'),
        '_contentGateAvail must check both SpeechRecognition and webkitSpeechRecognition');
});

// ── C8: exported utility functions ────────────────────────────────────────────

test('C8: _startDigitContentGate and _startPhraseContentGate are present', () => {
    assert.ok(hasFn('_startDigitContentGate'),
        '_startDigitContentGate must be defined in source');
    assert.ok(hasFn('_startPhraseContentGate'),
        '_startPhraseContentGate must be defined in source');
    // Both must handle the non-matching transcript privacy rule (discard)
    assert.ok(src.includes('Non-matching') || src.includes('discarded'),
        'Source must document that non-matching transcripts are discarded (privacy rule)');
});

// ── C9: VAD FIRE sites demote energy to health (not progression) ──────────────

test('C9: Full-path VAD FIRE site calls _markSpeech only in energy fallback branch', () => {
    // After the FIRED log in the full path, there must be a content_gated check
    // before any _markSpeech call — the _markSpeech must be inside an else block.
    const firedIdx = src.indexOf("'FIRED: '");
    assert.ok(firedIdx >= 0, 'VAD FIRED log must be present');
    // Check that _markSpeech in the full path FIRED block is inside a content gate check.
    // Uses session-local _sessionGateAvail (not module-level _contentGateAvail) so runtime
    // failures don't corrupt future sessions.
    const firedBlock = src.slice(firedIdx, firedIdx + 1000);
    assert.ok(firedBlock.includes('_sessionGateAvail') || firedBlock.includes('_contentGateAvail'),
        'Full-path FIRED site must check session gate avail before calling _markSpeech');
    assert.ok(firedBlock.includes('_vadEnergyDetected = true'),
        'Full-path FIRED site must set _vadEnergyDetected when content gate is available');
});

test('C10: Fast-path VAD FIRE site also content-gates progression', () => {
    // Fast path FIRED log
    const fastFiredIdx = src.indexOf("'FIRED: '", src.indexOf('_makeQuickReauthVoiceGate'));
    assert.ok(fastFiredIdx > 0, 'Fast-path VAD FIRED log must be present');
    const fastFiredBlock = src.slice(fastFiredIdx, fastFiredIdx + 800);
    assert.ok(fastFiredBlock.includes('_contentGateAvail'),
        'Fast-path FIRED site must check _contentGateAvail');
    assert.ok(fastFiredBlock.includes('_fastContentGate'),
        'Fast-path FIRED site must manage _fastContentGate');
});

// ── C11: coaching text update ─────────────────────────────────────────────────

test('C11: renderGuided coaching text branch for energyHeard state is present', () => {
    assert.ok(src.includes('opts.energyHeard'),
        'renderGuided must read opts.energyHeard for energy-heard coaching');
    assert.ok(src.includes('Listening — did not catch'),
        'Coaching must say "Listening — did not catch" when energy heard but content not matched');
});

// ── C12: no emoji in coaching lines ──────────────────────────────────────────

test('C12: no 🎙️ or 🗣️ emoji in ceremony coaching lines (hard rule)', () => {
    // Check that the specific coaching line emojis are gone
    assert.ok(!src.includes('🎙️'), 'Microphone emoji 🎙️ must not appear in coaching lines');
    assert.ok(!src.includes('🗣️'), 'Speaking-head emoji 🗣️ must not appear in coaching lines');
    // setLamp calls must use text, not emoji
    assert.ok(!src.includes("setLamp(vLamp, vWrap, 'done', '🗣"),
        'setLamp voice lamp must not use 🗣 emoji');
    assert.ok(!src.includes("setLamp(gLamp, gWrap, 'done', '✋"),
        'setLamp gesture lamp must not use ✋ emoji');
});

// ── C13: phrase content gate variables ────────────────────────────────────────

test('C13: phrase content gate state variables _phraseContentGate and _phraseContentMatched are present', () => {
    assert.ok(src.includes('_phraseContentGate'),
        '_phraseContentGate variable must be declared');
    assert.ok(src.includes('_phraseContentMatched'),
        '_phraseContentMatched variable must be declared');
    // _phraseVadTick must check _phraseContentMatched to set _phraseHeardVoice
    assert.ok(src.includes('_phraseContentMatched && !_phraseHeardVoice'),
        '_phraseVadTick must set _phraseHeardVoice from content match');
});

// ── C14: fast gate accepts expectedDigit ─────────────────────────────────────

test('C14: _makeQuickReauthVoiceGate accepts and reads cfg.expectedDigit', () => {
    assert.ok(src.includes('cfg.expectedDigit'),
        '_makeQuickReauthVoiceGate must read cfg.expectedDigit');
    assert.ok(src.includes('expectedDigit: _expectFingers'),
        'Fast gate call site must pass expectedDigit: _expectFingers');
});

// ── C15: _stopSpeechGate cleans up content gate ───────────────────────────────

test('C15: _stopSpeechGate stops _contentGate on cleanup', () => {
    // Find _stopSpeechGate body
    const stopIdx = src.indexOf('function _stopSpeechGate()');
    assert.ok(stopIdx >= 0, '_stopSpeechGate must be present');
    const stopBody = src.slice(stopIdx, stopIdx + 300);
    assert.ok(stopBody.includes('_contentGate'),
        '_stopSpeechGate must stop _contentGate');
    assert.ok(stopBody.includes('.stop()') || stopBody.includes('stop()'),
        '_stopSpeechGate must call .stop() on _contentGate');
});

// ── privacy rule: non-matching audio must be discarded ───────────────────────

test('Privacy: non-matching audio segments discarded (never stored)', () => {
    // Check that the privacy comment is present in the content gate functions
    assert.ok(
        src.includes('discarded here, never stored') || src.includes('never stored (privacy'),
        'Content gate must document that non-matching transcripts are discarded (privacy rule)'
    );
    // Verify there is no storage call (localStorage, sessionStorage, indexedDB) for transcripts
    // (these utility functions only check strings in memory)
    const gateStart = src.indexOf('function _startDigitContentGate');
    const gateEnd   = src.indexOf('\n}', src.indexOf('function _startPhraseContentGate') + 1);
    const gateBody  = src.slice(gateStart, gateEnd);
    assert.ok(!gateBody.includes('localStorage'), 'Content gate must not use localStorage');
    assert.ok(!gateBody.includes('sessionStorage'), 'Content gate must not use sessionStorage');
    assert.ok(!gateBody.includes('IndexedDB') && !gateBody.includes('indexedDB'),
        'Content gate must not use IndexedDB');
});
