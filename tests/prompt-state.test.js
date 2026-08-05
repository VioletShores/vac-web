// prompt-state.test.js — task-prompt-state-sync-v2
//
// SPEC: L-2246 PROMPT/STATE SYNC
// Rob's desync: #step2Title showed "Say the phrase" (greeting-phase copy) while the
// ceremony was already in the digit phase. Root cause: renderGreeting() fires on every
// phraseInterval tick and has NO check that _ceremonyPhase === 'greeting'. When
// clearInterval fires on phraseInterval and the digit phase starts, a final stale
// interval tick can still paint "Say the phrase" over the "Show the numbers" header.
//
// FAILING FIXTURE FIRST (written before the fix — verified to fail on pre-fix source):
//   F0: STATE_COACHING_MAP absent → asserts it now exists (desync bug detection)
//
// POST-FIX ASSERTIONS:
//   P1: STATE_COACHING_MAP has all 6 required phases
//   P2: 'digit' title != 'greeting' title (no shared strings that can desync)
//   P3: 'greeting' color is a distinct value from 'digit' (yellow vs none)
//   P4: _ceremonyPhase is a module-level variable
//   P5: _setPhase is a named function
//   P6: _renderPromptOnTransition is a named function
//   P7: renderGreeting has a _PHASE.GREETING guard (stale-tick desync block)
//   P8: startCountdown wires _setPhase (COUNTDOWN transition)
//   P9: beginRecording/phraseInterval entry wires _setPhase (GREETING transition)
//   P10: _advanceGreeting block wires _setPhase (DIGIT transition)
//   P11: finishFingerPhase wires _setPhase (PROCESSING transition)
//
// Run: node --test tests/prompt-state.test.js

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function hasConst(name) {
    return new RegExp('(?:const|var|let)\\s+' + name + '\\b').test(src);
}
function hasFn(name) {
    return src.includes('function ' + name + '(') || src.includes('function ' + name + ' (');
}

// Extract STATE_COACHING_MAP literal and eval it as a plain object.
function evalStateCoachingMap() {
    const marker = 'const STATE_COACHING_MAP =';
    const startIdx = src.indexOf(marker);
    if (startIdx < 0) throw new Error('STATE_COACHING_MAP not found in source');
    const objStart = src.indexOf('{', startIdx);
    let depth = 0, i = objStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return ' + src.slice(objStart, i) + ';')();
}

// ── F0: Failing fixture — proves the bug before the fix ──────────────────────
// PRE-FIX STATE: STATE_COACHING_MAP does not exist. renderGreeting() writes
// "Say the phrase" into step2Title on every phraseInterval tick with NO phase check,
// so the final stale tick after clearInterval can paint greeting text in the digit phase.

test('F0 (failing fixture → now fixed): STATE_COACHING_MAP exists in source', function() {
    assert.ok(
        src.includes('STATE_COACHING_MAP'),
        'DESYNC BUG PRESENT: STATE_COACHING_MAP absent — renderGreeting() has no phase guard ' +
        'and can write "Say the phrase" into step2Title after the digit phase begins (Rob L-2246 report)'
    );
});

// ── P1-P3: Map shape and uniqueness ──────────────────────────────────────────

test('P1: STATE_COACHING_MAP has all 6 required phases', function() {
    const map = evalStateCoachingMap();
    const required = ['idle', 'countdown', 'greeting', 'digit', 'processing', 'done'];
    for (const phase of required) {
        assert.ok(phase in map, 'STATE_COACHING_MAP missing phase: ' + phase);
        assert.ok(typeof map[phase].title === 'string', 'phase ' + phase + ' must have a string title');
    }
});

test('P2: digit title != greeting title (no shared string can desync)', function() {
    const map = evalStateCoachingMap();
    assert.notEqual(
        map.digit.title, map.greeting.title,
        'digit and greeting share the same title — desync would be invisible'
    );
});

test('P3: greeting has a distinct color from digit (yellow vs plain)', function() {
    const map = evalStateCoachingMap();
    assert.ok(
        map.greeting.color && map.greeting.color !== (map.digit.color || ''),
        'greeting must have a distinct color from digit to signal the active phase'
    );
});

// ── P4-P6: State variables and transition functions ───────────────────────────

test('P4: _ceremonyPhase module-level variable exists', function() {
    assert.ok(hasConst('_ceremonyPhase'), '_ceremonyPhase not declared in source');
});

test('P5: _setPhase function exists', function() {
    assert.ok(hasFn('_setPhase'), '_setPhase function not found in source');
});

test('P6: _renderPromptOnTransition function exists', function() {
    assert.ok(hasFn('_renderPromptOnTransition'), '_renderPromptOnTransition function not found in source');
});

// ── P7: renderGreeting guard ──────────────────────────────────────────────────
// This is the core fix: renderGreeting() must bail early if _ceremonyPhase is not
// 'greeting', so a stale phraseInterval tick cannot overwrite the digit-phase header.

test('P7: renderGreeting has _ceremonyPhase guard to prevent stale-tick desync', function() {
    // Find renderGreeting function body
    const fnStart = src.indexOf('function renderGreeting()');
    assert.ok(fnStart >= 0, 'renderGreeting not found in source');
    const braceStart = src.indexOf('{', fnStart);
    let depth = 0, i = braceStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const body = src.slice(fnStart, i);
    // Use a regex to require an actual conditional return, not just string presence in a comment.
    // Pattern: if (_ceremonyPhase !== _PHASE.GREETING) return;
    const guardPattern = /if\s*\(\s*_ceremonyPhase\s*!==\s*_PHASE\.GREETING\s*\)\s*return/;
    assert.ok(
        guardPattern.test(body),
        'renderGreeting() must contain the guard: if (_ceremonyPhase !== _PHASE.GREETING) return — ' +
        'string presence alone can pass even if the guard is inside a comment (L-2246)'
    );
});

// ── P8-P11: Transition wiring ─────────────────────────────────────────────────

test('P8: startCountdown wires _setPhase for COUNTDOWN transition', function() {
    const fnStart = src.indexOf('function startCountdown()');
    assert.ok(fnStart >= 0, 'startCountdown not found');
    // Use brace-counting (robust vs indentation) to extract the full function body
    const braceStart = src.indexOf('{', fnStart);
    let depth = 0, i = braceStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const body = src.slice(fnStart, i);
    assert.ok(
        body.includes('_setPhase') && body.includes('COUNTDOWN'),
        'startCountdown must call _setPhase(_PHASE.COUNTDOWN) to register the countdown phase'
    );
});

test('P9: GREETING phase transition wired before phraseInterval', function() {
    // The _setPhase(GREETING) call must appear in source before the phraseInterval setInterval
    const greetingWire = src.indexOf("_setPhase(_PHASE.GREETING)");
    const phraseIntervalSetup = src.indexOf('phraseInterval = setInterval');
    assert.ok(greetingWire >= 0, '_setPhase(_PHASE.GREETING) not found in source');
    assert.ok(phraseIntervalSetup >= 0, 'phraseInterval = setInterval not found in source');
    assert.ok(
        greetingWire < phraseIntervalSetup,
        '_setPhase(GREETING) must appear before phraseInterval setInterval — ' +
        'otherwise the first greeting tick fires without a phase set'
    );
});

test('P10: _advanceGreeting block wires _setPhase for DIGIT transition', function() {
    const advIdx = src.indexOf('if (_advanceGreeting)');
    assert.ok(advIdx >= 0, '_advanceGreeting block not found in source');
    // Find the block body (next { ... })
    const blockStart = src.indexOf('{', advIdx);
    let depth = 0, i = blockStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const block = src.slice(advIdx, i);
    assert.ok(
        block.includes('_setPhase') && block.includes('DIGIT'),
        '_advanceGreeting block must call _setPhase(_PHASE.DIGIT) to register the digit phase'
    );
});

test('P11: finishFingerPhase wires _setPhase for PROCESSING transition', function() {
    const fnStart = src.indexOf('function finishFingerPhase()');
    assert.ok(fnStart >= 0, 'finishFingerPhase not found');
    const braceStart = src.indexOf('{', fnStart);
    let depth = 0, i = braceStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const body = src.slice(fnStart, i);
    assert.ok(
        body.includes('_setPhase') && body.includes('PROCESSING'),
        'finishFingerPhase must call _setPhase(_PHASE.PROCESSING) to register the processing phase'
    );
});
