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

test('CB-MIC-01: VAD_SPEECH_RMS_FALLBACK matches founding fixture (time-domain scale, task-644)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    assert.ok(row, 'CB-MIC-01 row must be present in founding-rows.json');
    const val = constFromSource('VAD_SPEECH_RMS_FALLBACK');
    assert.equal(val, row.constants.VAD_SPEECH_RMS_FALLBACK,
        `VAD_SPEECH_RMS_FALLBACK=${val} must equal fixture value ${row.constants.VAD_SPEECH_RMS_FALLBACK} — ` +
        'time-domain RMS scale (was 0.115 freq-domain; 0.085 fires on normal speech 0.05-0.25 range)'
    );
});

test('CB-MIC-01: VAD_SILENCE_RMS_FALLBACK matches founding fixture (time-domain scale)', () => {
    const row = fixtures.rows.find((r) => r.id === 'CB-MIC-01');
    const val = constFromSource('VAD_SILENCE_RMS_FALLBACK');
    assert.equal(val, row.constants.VAD_SILENCE_RMS_FALLBACK,
        `VAD_SILENCE_RMS_FALLBACK=${val} must equal fixture value ${row.constants.VAD_SILENCE_RMS_FALLBACK}`
    );
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
