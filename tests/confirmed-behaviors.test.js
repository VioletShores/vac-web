// confirmed-behaviors.test.js — task-645-confirm-fixture-loop (S156)
//
// WHAT THIS IS: regression harness for behaviors confirmed correct at task-644 merge (22b2671).
// Pattern: source-extract (same as vad-replay.test.js / zone-geometry.test.js) — reads the ACTUAL
// shipped constants from source by name so they can never silently drift from the fixture values.
//
// THREE CONFIRMED BEHAVIORS (see tests/fixtures/confirmed/founding-rows.json):
//   CB-MIC-01: time-domain RMS gate fires on normal speech (iOS Safari 26 fix, task-644).
//              VAD_SPEECH_RMS_FALLBACK=0.085, FAST_VAD_SPEECH_RMS=0.085 (time-domain scale).
//              getByteTimeDomainData must be present at all 3 VAD RMS compute sites.
//   CB-ZONE-01: beside-cheek pose accepted — wrist(0.72,0.78) with anchored face = IN.
//               GESTURE_ZONE_SPEC rx=0.21, ry=0.26, minTipsInside=2, _FACE_SIDE_GAP=0.10.
//   CB-ZONE-02: drawn guide and acceptance gate consume identical _activeZone() numbers.
//               Single source of truth: no separate constant path for guide vs gate.
//
// CALIBRATION HASH GUARD: extracts the calibration block by marker comments and verifies its
// SHA256 matches the founding-rows fixture. Any change to the calibration block must update the
// fixture sha256 field and add a new fixture row.
//
// Run: node --test tests/confirmed-behaviors.test.js   (Node built-in runner, no deps)

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');

const SRC_PATH      = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const FIXTURE_PATH  = path.join(__dirname, 'fixtures', 'confirmed', 'founding-rows.json');

const src      = fs.readFileSync(SRC_PATH, 'utf8');
const fixtures = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

// Pull a `const NAME = <expr>;` value straight out of the shipped source by name, regardless of
// indentation/scope. Works for both module-level and function-local consts (full-file scan).
function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in ${SRC_PATH} — fixture and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    return value;
}

// Extract a numeric field from GESTURE_ZONE_SPEC's Object.freeze({...}) literal.
function zoneSpecFieldFromSource(fieldName) {
    const m = src.match(new RegExp(fieldName + '\\s*:\\s*([\\d.]+)'));
    assert.ok(m, `expected "${fieldName}: <number>" in GESTURE_ZONE_SPEC — fixture and source have diverged`);
    return parseFloat(m[1]);
}

// Extract the calibration block body: content from the newline after the begin marker line
// through the newline before the end marker line, trimmed.
function extractCalibrationBlock() {
    const startMarker = fixtures.calibration_block.marker_start;
    const endMarker   = fixtures.calibration_block.marker_end;
    const startIdx    = src.indexOf(startMarker);
    const endIdx      = src.indexOf(endMarker);
    assert.ok(startIdx >= 0, `calibration block BEGIN marker not found: "${startMarker}"`);
    assert.ok(endIdx   >= 0, `calibration block END marker not found: "${endMarker}"`);
    const afterBeginLine  = src.indexOf('\n', startIdx) + 1;
    const beforeEndLine   = src.lastIndexOf('\n', endIdx);
    return src.slice(afterBeginLine, beforeEndLine).trim();
}

// --- CB-MIC-01: time-domain RMS gate ---
// S156 rewrite (chat-hotfix packet): the CONFIRMED BEHAVIOR is "the gate is
// crossable by normal indoor speech (time-domain 0.05-0.25) and sits above the
// tap/ambient floor" — NOT "the constant equals a specific value". Constant-
// equality froze the very number the design says must adapt (spec 4.2.3 g4);
// it failed the S156 hotfix that lowered 0.085→0.055 for a live-blocked user.
// Exact-value pinning belongs to the calibration-hash guard (with citation),
// never to a behavior fixture.

const NORMAL_SPEECH_MIN = 0.05;   // quiet normal voice, time-domain RMS
const AMBIENT_FLOOR_MAX = 0.030;  // tap/room noise ceiling observed on-device

test('CB-MIC-01: speech fallback is crossable by normal voice and above ambient floor', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    assert.ok(row, 'CB-MIC-01 row must be present in founding-rows.json');
    const val = constFromSource('VAD_SPEECH_RMS_FALLBACK');
    assert.ok(val <= NORMAL_SPEECH_MIN + 0.015,
        `VAD_SPEECH_RMS_FALLBACK=${val} must be reachable by normal speech (<= ~${NORMAL_SPEECH_MIN + 0.015}) — Rob live-confirmed 6 Aug: raised voice must never be required`);
    assert.ok(val > AMBIENT_FLOOR_MAX,
        `VAD_SPEECH_RMS_FALLBACK=${val} must exceed ambient/tap floor ${AMBIENT_FLOOR_MAX}`);
});

test('CB-MIC-01: silence fallback sits strictly below the speech fallback', () => {
    const speech = constFromSource('VAD_SPEECH_RMS_FALLBACK');
    const silence = constFromSource('VAD_SILENCE_RMS_FALLBACK');
    assert.ok(silence < speech,
        `VAD_SILENCE_RMS_FALLBACK=${silence} must be strictly below speech=${speech} (hysteresis gap required for onset detection)`);
    assert.ok(silence >= 0.015,
        `VAD_SILENCE_RMS_FALLBACK=${silence} must stay above true-silence noise (>= 0.015)`);
});

test('CB-MIC-01: FAST_VAD_SPEECH_RMS matches founding fixture (mirrors VAD_SPEECH_RMS_FALLBACK)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    const val = constFromSource('FAST_VAD_SPEECH_RMS');
    assert.equal(val, row.constants.FAST_VAD_SPEECH_RMS,
        `FAST_VAD_SPEECH_RMS=${val} must equal fixture value ${row.constants.FAST_VAD_SPEECH_RMS} — ` +
        'fast tier must mirror full-path fallback (both time-domain, same scale)'
    );
});

test('CB-MIC-01: FAST_VAD_SILENCE_RMS matches founding fixture (mirrors VAD_SILENCE_RMS_FALLBACK)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    const val = constFromSource('FAST_VAD_SILENCE_RMS');
    assert.equal(val, row.constants.FAST_VAD_SILENCE_RMS,
        `FAST_VAD_SILENCE_RMS=${val} must equal fixture value ${row.constants.FAST_VAD_SILENCE_RMS}`
    );
});

test('CB-MIC-01: getByteTimeDomainData present at >=3 VAD RMS compute sites (one per VAD tier)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    const pattern = row.pattern_required;
    const hits = (src.match(new RegExp(pattern, 'g')) || []).length;
    assert.ok(hits >= 3,
        `expected >= 3 occurrences of "${pattern}" (digit VAD tick, phrase VAD tick, quick-reauth tier) — ` +
        `found ${hits}. iOS Safari 26 fix: time-domain replaces getByteFrequencyData which stayed ~0.01 during live speech.`
    );
});

test('CB-MIC-01: getByteFrequencyData is NOT used for RMS gate decisions (freq-domain RMS removed by task-644)', () => {
    // Freq-domain fetches are still present for voiceBandRatio / spectral checks — we only
    // assert they are NOT immediately followed by the sqrt(mean((v-128)^2)) RMS accumulation,
    // which would indicate a freq-domain RMS path (the pre-644 bug).
    // Pattern requires actual function-call syntax `getByteFrequencyData(` (not comment text)
    // followed by the rms accumulation loop within 300 chars.
    const freqDomainRmsPattern = /getByteFrequencyData\s*\([^)]*\)[\s\S]{0,300}rms\s*\+=\s*_v\s*\*\s*_v/;
    assert.ok(
        !freqDomainRmsPattern.test(src),
        'getByteFrequencyData() call must not precede the rms accumulation loop — time-domain (getByteTimeDomainData) is the RMS source after task-644'
    );
});

// --- CB-ZONE-01: cheek-zone relax ---

test('CB-ZONE-01: GESTURE_ZONE_SPEC.rx matches founding fixture (task-644: 0.17->0.21)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-01');
    const val = zoneSpecFieldFromSource('rx');
    assert.equal(val, row.constants.GESTURE_ZONE_SPEC_rx,
        `GESTURE_ZONE_SPEC.rx=${val} must equal ${row.constants.GESTURE_ZONE_SPEC_rx} — beside-cheek natural pose relaxation`
    );
});

test('CB-ZONE-01: GESTURE_ZONE_SPEC.ry matches founding fixture (task-644: 0.22->0.26)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-01');
    const val = zoneSpecFieldFromSource('ry');
    assert.equal(val, row.constants.GESTURE_ZONE_SPEC_ry,
        `GESTURE_ZONE_SPEC.ry=${val} must equal ${row.constants.GESTURE_ZONE_SPEC_ry}`
    );
});

test('CB-ZONE-01: GESTURE_ZONE_SPEC.minTipsInside matches founding fixture (task-644: 3->2)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-01');
    const val = zoneSpecFieldFromSource('minTipsInside');
    assert.equal(val, row.constants.GESTURE_ZONE_SPEC_minTipsInside,
        `GESTURE_ZONE_SPEC.minTipsInside=${val} must equal ${row.constants.GESTURE_ZONE_SPEC_minTipsInside} — palm-centre OR 2 fingertips accepted`
    );
});

test('CB-ZONE-01: _FACE_SIDE_GAP matches founding fixture (task-644: 0.03->0.10)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-01');
    const val = constFromSource('_FACE_SIDE_GAP');
    assert.equal(val, row.constants._FACE_SIDE_GAP,
        `_FACE_SIDE_GAP=${val} must equal ${row.constants._FACE_SIDE_GAP} — ovals pushed beside face not on it`
    );
});

// --- CB-ZONE-02: _activeZone() parity (single source of truth) ---

test('CB-ZONE-02: _activeZone() is the single point-test source — _ptInCheekZone calls _activeZone() and is the only oval-intersection primitive', () => {
    assert.ok(src.includes('function _activeZone()'), '_activeZone() must be defined in source');
    // The acceptance gate chain is: _handNearFaceZone -> _ptInCheekZone -> _activeZone().
    // _ptInCheekZone is the oval-intersection primitive; it must read _activeZone() not a copy.
    const ptIdx = src.indexOf('function _ptInCheekZone');
    assert.ok(ptIdx >= 0, '_ptInCheekZone must be defined (oval-intersection primitive)');
    // Extract its body by brace-counting
    let depth = 0, i = ptIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const fnBody = src.slice(ptIdx, i);
    assert.ok(fnBody.includes('_activeZone()'),
        '_ptInCheekZone must call _activeZone() — the oval-intersection primitive must read the single live geometry source, not a hard-coded copy of GESTURE_ZONE_SPEC'
    );
});

test('CB-ZONE-02: _handNearFaceZone acceptance gate calls _ptInCheekZone (not a separate oval path)', () => {
    const gateIdx = src.indexOf('function _handNearFaceZone');
    assert.ok(gateIdx >= 0, '_handNearFaceZone must be defined (acceptance gate for gesture step)');
    let depth = 0, i = gateIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const fnBody = src.slice(gateIdx, i);
    assert.ok(fnBody.includes('_ptInCheekZone'),
        '_handNearFaceZone must delegate to _ptInCheekZone — the single oval-intersection primitive that calls _activeZone()'
    );
});

test('CB-ZONE-02: _activeZone() called from _drawFingerTargetGuide (guide uses same geometry as gate)', () => {
    const guideIdx = src.indexOf('function _drawFingerTargetGuide');
    assert.ok(guideIdx >= 0, '_drawFingerTargetGuide must be defined (pre-flight + quick-auth guide draw)');
    let depth = 0, i = guideIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    const fnEnd = (function() {
        while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) return i + 1; } i++; }
        return i;
    })();
    const fnBody = src.slice(guideIdx, fnEnd);
    assert.ok(fnBody.includes('_activeZone()'),
        '_drawFingerTargetGuide guide-draw must call _activeZone() — drawn ovals must match acceptance gate geometry'
    );
});

test('CB-ZONE-02: _activeZone() called from _avDrawHand (full-auth guide uses same geometry as gate)', () => {
    const drawIdx = src.indexOf('function _avDrawHand');
    assert.ok(drawIdx >= 0, '_avDrawHand must be defined (full-auth hand guide draw)');
    let depth = 0, i = drawIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    const fnEnd = (function() {
        while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) return i + 1; } i++; }
        return i;
    })();
    const fnBody = src.slice(drawIdx, fnEnd);
    assert.ok(fnBody.includes('_activeZone()'),
        '_avDrawHand full-auth guide-draw must call _activeZone() — drawn ovals must match acceptance gate geometry'
    );
});

// --- CB-ZONE-03: double-stroke halo on guide ovals (task-646) ---

// Helper: extract a named top-level function body by brace-counting.
function extractNamedFnBody(fnName) {
    const fnStart = src.indexOf('function ' + fnName + '(');
    assert.ok(fnStart >= 0, fnName + ' not found in source');
    let depth = 0, i = fnStart;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) { i++; break; } }
        i++;
    }
    return src.slice(fnStart, i);
}

// Spy ctx — records strokeStyle, lineWidth, and globalAlpha at the moment stroke() is called.
function makeSpyCtx() {
    const spy = {
        strokes: [], dashCalls: [],
        strokeStyle: '', lineWidth: 0, globalAlpha: 1,
        shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
        fillStyle: '', font: '', textAlign: '', textBaseline: '',
        save() {}, restore() {}, beginPath() {}, fill() {},
        translate() {}, scale() {}, fillText() {}, fillRect() {},
        arc() {}, moveTo() {}, lineTo() {}, ellipse() {},
        measureText() { return { width: 10 }; },
        setLineDash(d) { if (d && d.length) spy.dashCalls.push([...d]); },
        stroke() { spy.strokes.push({ style: String(spy.strokeStyle), width: Number(spy.lineWidth), alpha: Number(spy.globalAlpha) }); },
    };
    return spy;
}

// Run _drawFingerTargetGuide with zone EMPTY (lm=null, active side='right'), DPR=1.
// performance.now() returns 600 (mid-cycle) so _pulse646 = 0.65 — clearly below the default of 1.0,
// letting tests verify the pulse is actually applied rather than default globalAlpha being left unchanged.
// Returns the spy ctx after execution so tests can inspect captured draw calls.
function runDrawGuide() {
    const fnText = extractNamedFnBody('_drawFingerTargetGuide');
    const spyCtx = makeSpyCtx();
    const wrapper = `
        var _activeZone = function() {
            return { ovals: [{ cx: 0.28, cy: 0.50, side: 'left' }, { cx: 0.72, cy: 0.50, side: 'right' }], rx: 0.21, ry: 0.26 };
        };
        var _handNearFaceZone = function() { return false; };
        var _AV_HAND_CONN = [];
        var devicePixelRatio = 1;
        var performance = { now: function() { return 600; } };
        ${fnText}
        _drawFingerTargetGuide(ctx, 100, 100, 3, 'right', null);
    `;
    (new Function('ctx', wrapper))(spyCtx);
    return spyCtx;
}

test('CB-ZONE-03: zone guide dark outer halo present — reads on bright camera feeds', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    assert.ok(row, 'CB-ZONE-03 row must be present in founding-rows.json');
    const { strokes } = runDrawGuide();
    const outerColor = row.draw.outer_stroke_color;
    assert.ok(
        strokes.some((s) => s.style === outerColor),
        `outer halo stroke must use "${outerColor}" — found: ${JSON.stringify(strokes.map((s) => s.style))}`
    );
});

test('CB-ZONE-03: zone guide gold inner stroke present with opacity >= 0.9', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const { strokes } = runDrawGuide();
    const innerColor = row.draw.inner_stroke_color;
    const innerStroke = strokes.find((s) => s.style === innerColor);
    assert.ok(innerStroke,
        `inner stroke must use "${innerColor}" — found: ${JSON.stringify(strokes.map((s) => s.style))}`
    );
    const alphaMatch = innerColor.match(/rgba\s*\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/);
    const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
    assert.ok(alpha >= row.draw.inner_opacity_min,
        `inner stroke opacity ${alpha} must be >= ${row.draw.inner_opacity_min} (task-646 legibility requirement)`
    );
});

test('CB-ZONE-03: zone guide inner stroke lineWidth >= 2px logical (floor rule, DPR=1 in test)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const { strokes } = runDrawGuide();
    const innerColor = row.draw.inner_stroke_color;
    const innerStroke = strokes.find((s) => s.style === innerColor);
    assert.ok(innerStroke, `inner stroke "${innerColor}" not found in draw calls`);
    assert.ok(
        innerStroke.width >= row.draw.inner_linewidth_logical_min,
        `inner stroke lineWidth ${innerStroke.width} must be >= ${row.draw.inner_linewidth_logical_min} (2px logical minimum at DPR=1)`
    );
});

test('CB-ZONE-03: zone guide setLineDash called with longer dashes (first element >= 8px)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const { dashCalls } = runDrawGuide();
    assert.ok(
        dashCalls.some((d) => d.length > 0 && d[0] >= row.draw.dash_length_min),
        `setLineDash must be called with dash length >= ${row.draw.dash_length_min} — found: ${JSON.stringify(dashCalls)}`
    );
});

test('CB-ZONE-03: outer halo lineWidth > inner lineWidth — halo is visually distinct (no floor collapse)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const { strokes } = runDrawGuide();
    const outerColor = row.draw.outer_stroke_color;
    const innerColor = row.draw.inner_stroke_color;
    const outerStroke = strokes.find((s) => s.style === outerColor);
    const innerStroke = strokes.find((s) => s.style === innerColor);
    assert.ok(outerStroke, `outer stroke "${outerColor}" not found`);
    assert.ok(innerStroke, `inner stroke "${innerColor}" not found`);
    assert.ok(
        outerStroke.width > innerStroke.width,
        `outer lineWidth ${outerStroke.width} must be > inner lineWidth ${innerStroke.width} — floor collapse would make the double-stroke invisible`
    );
});

test('CB-ZONE-03: opacity pulse applied — globalAlpha < 1.0 at mid-cycle (performance.now()=600)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const { strokes } = runDrawGuide();
    const innerColor = row.draw.inner_stroke_color;
    const innerStroke = strokes.find((s) => s.style === innerColor);
    assert.ok(innerStroke, `inner stroke "${innerColor}" not found`);
    // At t=600ms: _pulse = 0.65 + 0.35 * (1 + cos(π)) / 2 = 0.65 (minimum).
    // Any value < 1.0 proves the pulse is wired up rather than globalAlpha left at default.
    assert.ok(
        innerStroke.alpha < 1.0,
        `inner stroke globalAlpha ${innerStroke.alpha} must be < 1.0 at mid-cycle — pulse not applied`
    );
});

test('CB-ZONE-03: _avDrawHand contains double-stroke halo colors (source structural check)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-ZONE-03');
    const drawIdx = src.indexOf('function _avDrawHand');
    assert.ok(drawIdx >= 0, '_avDrawHand must be defined');
    let depth = 0, i = drawIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    const fnEnd = (() => { while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) return i + 1; } i++; } return i; })();
    const fnBody = src.slice(drawIdx, fnEnd);
    assert.ok(
        fnBody.includes(row.draw.outer_stroke_color),
        `_avDrawHand must contain outer halo color "${row.draw.outer_stroke_color}"`
    );
    assert.ok(
        fnBody.includes(row.draw.inner_stroke_color),
        `_avDrawHand must contain inner gold color "${row.draw.inner_stroke_color}"`
    );
});

// --- CALIBRATION HASH GUARD ---

test('CALIBRATION HASH GUARD: calibration block SHA256 matches founding-rows fixture (CB-MIC-01 provenance lock)', () => {
    const blockContent = extractCalibrationBlock();
    const actualSha = crypto.createHash('sha256').update(blockContent).digest('hex');
    const expectedSha = fixtures.calibration_block.sha256;
    assert.equal(actualSha, expectedSha,
        'Calibration block SHA256 mismatch — the mic-preflight VAD calibration block in vac-reauth-ceremony.js ' +
        'has changed since the CB-MIC-01 founding fixture was written. ' +
        'If this change is intentional: (1) add a new fixture row (bump rev), ' +
        '(2) update calibration_block.sha256 in tests/fixtures/confirmed/founding-rows.json to: ' + actualSha
    );
});
