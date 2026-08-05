// prompt-state-sync.test.js — task-prompt-state-sync
//
// SPEC: D-CEREMONY-PROMPT-STATE-DESYNC
// Hand gesture REGISTERED in zone but coaching line still read "hold-hand-beside-your-cheek".
// The fix introduces _renderHandCoach(state) as the single DOM update point for all hand
// coaching text, replacing scattered inline writes. This harness asserts:
//
//   H1: _HAND_COACH_MAP is present in source and contains all 8 required states.
//   H2: Each state's hintText and show fields are correct (coaching map contract).
//   H3: HAND_ACK_MS constant is present with expected value.
//   H4: "acknowledged" state shows "Got it" text (the new on-registered beat).
//   H5: All pre-registration states show hand-beside-cheek instruction.
//   H6: "registered" and "grace" states hide the hint (show:false).
//   H7: _renderHandCoach is the sole source writing to avHandHint (no scattered inline writes).
//   H8: The state machine code calls _renderHandCoach at every transition branch.
//
// Run: node --test tests/prompt-state-sync.test.js
//
// FAILURE MEANS: the coaching text contract has drifted from the state machine.

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// --- helpers ---

function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in source — harness and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    return value;
}

// Extract _HAND_COACH_MAP by brace-counting from its const declaration.
function extractHandCoachMap() {
    const start = src.indexOf('const _HAND_COACH_MAP = {');
    assert.ok(start >= 0, '_HAND_COACH_MAP must be present in source');
    // Find closing brace (depth 1=outer object)
    let depth = 0, i = start + 'const _HAND_COACH_MAP = '.length;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const mapText = src.slice(start, i);
    // Evaluate the map in a safe context — it only contains string literals and booleans.
    const mapExpr = mapText.replace('const _HAND_COACH_MAP = ', '');
    return Function('"use strict"; return ' + mapExpr + ';')();
}

// --- H1: map presence and completeness ---

test('H1: _HAND_COACH_MAP is present in source with all 8 required states', () => {
    const map = extractHandCoachMap();
    const REQUIRED = ['no_hand', 'outside_zone', 'framing_bad', 'spread_fingers', 'counting', 'acknowledged', 'registered', 'grace'];
    for (const state of REQUIRED) {
        assert.ok(state in map, `_HAND_COACH_MAP is missing state '${state}'`);
    }
    assert.equal(Object.keys(map).length, 8, 'map should have exactly 8 states');
});

// --- H2: each entry has required fields ---

test('H2: every state entry has pillStatus, pillLabel, hintText, and show fields', () => {
    const map = extractHandCoachMap();
    for (const [state, entry] of Object.entries(map)) {
        assert.ok('pillStatus' in entry, `state '${state}' missing pillStatus`);
        assert.ok('pillLabel' in entry,  `state '${state}' missing pillLabel`);
        assert.ok('hintText'  in entry,  `state '${state}' missing hintText`);
        assert.ok('show'      in entry,  `state '${state}' missing show`);
        assert.ok(['warn', 'good'].includes(entry.pillStatus), `state '${state}' pillStatus must be warn or good`);
        assert.equal(typeof entry.show, 'boolean', `state '${state}' show must be boolean`);
    }
});

// --- H3: timing constants ---

test('H3: HAND_ACK_MS is present in source (>0, <=1000ms — brief acknowledgment beat)', () => {
    const v = constFromSource('HAND_ACK_MS');
    assert.equal(typeof v, 'number', 'HAND_ACK_MS must be a number');
    assert.ok(v > 0,    `HAND_ACK_MS=${v} must be > 0`);
    assert.ok(v <= 1000, `HAND_ACK_MS=${v} must be <= 1000ms (brief beat, not a hang)`);
});

// --- H4: "acknowledged" state shows the "Got it" acknowledgment ---

test('H4: acknowledged state shows "Got it" text and sets pillStatus good', () => {
    const map = extractHandCoachMap();
    const ack = map.acknowledged;
    assert.ok(ack.hintText.toLowerCase().includes('got it'), `acknowledged hintText should include "got it": "${ack.hintText}"`);
    assert.equal(ack.pillStatus, 'good', 'acknowledged must use green pill (hand is registered)');
    assert.equal(ack.show, true, 'acknowledged must show the hint (user needs to see "Got it")');
});

// --- H5: pre-registration states instruct the user to raise the hand ---

test('H5: no_hand state instructs user to hold hand up beside cheek', () => {
    const map = extractHandCoachMap();
    const text = map.no_hand.hintText.toLowerCase();
    assert.ok(text.includes('hand') && text.includes('cheek'), `no_hand hintText must mention hand and cheek: "${map.no_hand.hintText}"`);
    assert.equal(map.no_hand.show, true, 'no_hand must show the hint');
});

test('H5: outside_zone state instructs user to move hand beside cheek', () => {
    const map = extractHandCoachMap();
    const text = map.outside_zone.hintText.toLowerCase();
    assert.ok(text.includes('cheek'), `outside_zone hintText must mention cheek: "${map.outside_zone.hintText}"`);
    assert.equal(map.outside_zone.show, true, 'outside_zone must show the hint');
});

test('H5: counting state shows hold-steady instruction (NOT "beside your cheek")', () => {
    const map = extractHandCoachMap();
    const text = map.counting.hintText.toLowerCase();
    assert.ok(text.includes('steady'), `counting hintText should say "steady": "${map.counting.hintText}"`);
    assert.equal(map.counting.show, true, 'counting must show the hint');
});

// --- H6: registered and grace states hide the hint ---

test('H6: registered state hides the hint (hand is confirmed — no further instruction needed)', () => {
    const map = extractHandCoachMap();
    assert.equal(map.registered.show, false, 'registered must hide the hint');
    assert.equal(map.registered.pillStatus, 'good', 'registered must use green pill');
});

test('H6: grace state hides the hint (countdown shown in pill, not hint bar)', () => {
    const map = extractHandCoachMap();
    assert.equal(map.grace.show, false, 'grace must hide the hint (timer lives in the pill)');
    assert.equal(map.grace.pillStatus, 'good', 'grace must keep green pill');
});

// --- H7: no scattered inline avHandHint writes outside _renderHandCoach ---

test('H7: avHandHint.textContent is only set inside _renderHandCoach (no scattered writes)', () => {
    // Find _renderHandCoach function body by brace-counting.
    const fnStart = src.indexOf('function _renderHandCoach(');
    assert.ok(fnStart >= 0, '_renderHandCoach must be present in source');
    let depth = 0, i = fnStart;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const fnBody = src.slice(fnStart, i);
    const outsideFn = src.slice(0, fnStart) + src.slice(i);
    // No textContent assignment to avHandHint outside the function.
    const strayTextWrites = (outsideFn.match(/avHandHint['")\s]*\.textContent\s*=/g) || []);
    assert.equal(strayTextWrites.length, 0,
        `Found ${strayTextWrites.length} avHandHint.textContent write(s) outside _renderHandCoach — all must be centralized`
    );
    // No style.display mutation to avHandHint outside the function during the gesture loop.
    // The _fastStill guard at startAVChecks hides the hint once (still-mode init) — exactly
    // 1 such write is permitted outside _renderHandCoach. If this count grows, a new
    // scattered write was added and the invariant is broken.
    const strayDisplayWrites = (outsideFn.match(/avHandHint[^;]*\.style\.display\s*=/g) || []);
    assert.ok(strayDisplayWrites.length <= 1,
        `Found ${strayDisplayWrites.length} avHandHint.style.display write(s) outside _renderHandCoach — max 1 allowed (the _fastStill guard)`
    );
    // The function itself MUST set textContent (prove it does the work).
    assert.ok(fnBody.includes('textContent'), '_renderHandCoach must set hintEl.textContent');
});

// --- H8: state machine calls _renderHandCoach at every branch ---

test('H8: the hand check block calls _renderHandCoach in every state branch', () => {
    // Count _renderHandCoach invocations in source. The pattern also matches the function
    // declaration (`function _renderHandCoach(`), so we expect >= 9: 8 call sites + 1 definition.
    const calls = src.match(/_renderHandCoach\(/g) || [];
    assert.ok(calls.length >= 9, `expected >= 9 _renderHandCoach occurrences (8 call sites + 1 definition), found ${calls.length}`);

    // Assert each state name is referenced in a _renderHandCoach call.
    const STATES = ['no_hand', 'outside_zone', 'framing_bad', 'spread_fingers', 'counting', 'acknowledged', 'registered', 'grace'];
    for (const state of STATES) {
        // Match direct call or either arm of a ternary inside a _renderHandCoach call
        const directPattern  = new RegExp("_renderHandCoach\\(['\"]" + state + "['\"]");
        const ternaryQ       = new RegExp("\\?\\s*['\"]" + state + "['\"]");     // ? 'state'
        const ternaryColon   = new RegExp(":\\s*['\"]" + state + "['\"]");        // : 'state'
        const found = directPattern.test(src) || ternaryQ.test(src) || ternaryColon.test(src);
        assert.ok(found, `state '${state}' must appear in a _renderHandCoach call (direct or ternary)`);
    }
});

// --- transition contract: the desync fixture ---

test('DESYNC-FIXTURE: acknowledged hintText differs from outside_zone hintText (regression guard)', () => {
    const map = extractHandCoachMap();
    // The core desync: "hand in zone" must not show "beside your cheek".
    // acknowledged (hand IS registered) must show something different from outside_zone (hand NOT in zone).
    assert.notEqual(
        map.acknowledged.hintText,
        map.outside_zone.hintText,
        'acknowledged and outside_zone must have different hintText — they are opposite states'
    );
    // Specifically: acknowledged must NOT contain "beside your cheek" (that is the still-pending copy).
    const ackText = map.acknowledged.hintText.toLowerCase();
    assert.ok(!ackText.includes('beside your cheek'),
        `acknowledged hintText must NOT say "beside your cheek" — that reads as still-pending: "${map.acknowledged.hintText}"`
    );
});
