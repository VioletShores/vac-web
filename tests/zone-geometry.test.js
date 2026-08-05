// zone-geometry.test.js — task-zone-harness-then-fix
//
// SPEC RESEARCH (h) — VERIFICATION TOOL DISCOVERY:
// Chrome headless with --use-fake-device-for-media-stream was evaluated.
// CHOICE: source-extract (same pattern as vad-replay.test.js) was chosen because:
//   (a) auth.html loads MediaPipe CDN + model download (~10 MB) — makes headless
//       timing non-deterministic and CI flaky on cold runs.
//   (b) Zone geometry is PURE MATH in _activeZone() — no camera needed to assert
//       on it; the __zoneDebug hook exists for live interactive debugging.
//   (c) Consistent with the established codebase pattern: extract the ACTUAL
//       formula from source so constants can never silently drift from tests.
//
// window.__zoneDebug (in vac-reauth-ceremony.js, gated on ?qa=1) lets a live page
// expose the same geometry for interactive QA sessions.
//
// VANISH REGRESSION (d8a1374 revert SHA): 94ba1b9 made ovals vanish in Rob's live
// run. Fixture #1 (A1 / A3 near) reproduces the geometry failure: ovals were pushed
// to the frame edges with cxLeft = rx (inner edge = 0, center at edge) and the oval
// inner edge OVERLAPPED the detected face (negative gap). The harness catches this
// at all three seating distances.
//
// FIXTURE POSITIONS (normalized face coords, cx=0.5 centred):
//   far:  hFrac 0.20 — small face, user well back from camera
//   mid:  hFrac 0.35 — typical seated laptop distance
//   near: hFrac 0.55 — close to camera, common phone/tablet angle
//
// Off-centre fixtures exercise cxLeft/cxRight clamp paths (cx = 0.20 / 0.80).
//
// ASSERTIONS:
//   A1: both ovals fully within frame bounds [0, 1] (each cx±rx in [0,1])
//   A2: oval width (2*rx) <= 0.55 * detected face width
//   A3: gap between face edge and oval inner edge >= 0.10 face widths AND <= 0.50
//       (centred fixtures only — clamp wins for off-centre edge cases)
//
// Run: node --test tests/zone-geometry.test.js   (Node built-in runner, no deps)

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// --- helpers (same pattern as vad-replay.test.js) ---

function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in ${SRC_PATH} — harness and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.equal(typeof value, 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// Extract the _activeZone() function body from source and evaluate it with
// test-injected face anchor values.  Closure variables are substituted before
// evaluation so the test runs the EXACT shipped formula, not a hand-copy.
function computeZoneFromSource(cx, cy, hFrac) {
    const FACE_ASPECT   = constFromSource('_FACE_ASPECT');
    const FACE_SIDE_GAP = constFromSource('_FACE_SIDE_GAP');

    // Locate the function by brace-counting from its definition line.
    const start = src.indexOf('function _activeZone()');
    assert.ok(start >= 0, '_activeZone() not found in source');
    let depth = 0, i = start;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    const fnText = src.slice(start, i);

    // Wrap in a self-contained IIFE that pre-defines the closure vars used by
    // _activeZone(), then calls it with the injected face anchor.
    const wrapped = `(function() {
        var _faceAnchor = { anchored: true, cx: ${cx}, cy: ${cy}, hFrac: ${hFrac} };
        var _FACE_ASPECT   = ${FACE_ASPECT};
        var _FACE_SIDE_GAP = ${FACE_SIDE_GAP};
        var GESTURE_ZONE_SPEC = {
            ovals: [{ cx: 0.18, cy: 0.48, side: 'left' }, { cx: 0.82, cy: 0.48, side: 'right' }],
            rx: 0.17, ry: 0.22
        };
        ${fnText}
        return _activeZone();
    })()`;

    return Function('"use strict"; return ' + wrapped + ';')();
}

// Five fixture positions: centred at 3 distances + off-centre edge cases.
const FIXTURES = [
    { name: 'far',        cx: 0.5,  cy: 0.5, hFrac: 0.20 },
    { name: 'mid',        cx: 0.5,  cy: 0.5, hFrac: 0.35 },
    { name: 'near',       cx: 0.5,  cy: 0.5, hFrac: 0.55 },
    { name: 'edge-left',  cx: 0.20, cy: 0.5, hFrac: 0.35 },
    { name: 'edge-right', cx: 0.80, cy: 0.5, hFrac: 0.35 },
];

// --- structural source checks ---

test('_activeZone() is present in source and returns an anchored shape', () => {
    assert.ok(src.includes('function _activeZone()'), '_activeZone() must be in source');
    assert.ok(src.includes('window.__zoneDebug'), 'window.__zoneDebug hook must be present for live debugging');
    const z = computeZoneFromSource(0.5, 0.5, 0.35);
    assert.ok(z && z.ovals && z.ovals.length === 2, 'zone must have two ovals');
    assert.ok(Number.isFinite(z.rx) && z.rx > 0, 'rx must be a positive finite number');
    assert.ok(Number.isFinite(z.ry) && z.ry > 0, 'ry must be a positive finite number');
});

// --- geometry assertions across all fixture scales ---

const FACE_ASPECT = constFromSource('_FACE_ASPECT');

for (const fix of FIXTURES) {
    test(`[${fix.name}] A1: both ovals fully within frame bounds (hFrac=${fix.hFrac})`, () => {
        const z = computeZoneFromSource(fix.cx, fix.cy, fix.hFrac);
        const leftOval  = z.ovals.find(o => o.side === 'left')  || z.ovals[0];
        const rightOval = z.ovals.find(o => o.side === 'right') || z.ovals[1];
        assert.ok(
            leftOval.cx - z.rx >= 0,
            `left oval left edge ${(leftOval.cx - z.rx).toFixed(4)} must be >= 0`
        );
        assert.ok(
            leftOval.cx + z.rx <= 1,
            `left oval right edge ${(leftOval.cx + z.rx).toFixed(4)} must be <= 1`
        );
        assert.ok(
            rightOval.cx - z.rx >= 0,
            `right oval left edge ${(rightOval.cx - z.rx).toFixed(4)} must be >= 0`
        );
        assert.ok(
            rightOval.cx + z.rx <= 1,
            `right oval right edge ${(rightOval.cx + z.rx).toFixed(4)} must be <= 1`
        );
    });

    test(`[${fix.name}] A2: oval width <= 0.55 * face width (hFrac=${fix.hFrac})`, () => {
        const z = computeZoneFromSource(fix.cx, fix.cy, fix.hFrac);
        const faceW = fix.hFrac * FACE_ASPECT;
        const ovalW = 2 * z.rx;
        assert.ok(
            ovalW <= 0.55 * faceW,
            `oval width ${ovalW.toFixed(4)} must be <= 0.55 * faceW ${(0.55 * faceW).toFixed(4)} (ratio ${(ovalW / faceW).toFixed(3)})`
        );
    });

    // A3: gap between face edge and oval inner edge. Centred fixtures only —
    // off-centre edge cases trigger the on-screen clamp and the gap spec yields
    // to visibility (the oval stays on screen even if gap falls outside [0.10, 0.50]).
    if (fix.cx === 0.5) test(`[${fix.name}] A3: gap between face edge and oval inner edge in [0.10, 0.50] face widths (hFrac=${fix.hFrac})`, () => {
        const z = computeZoneFromSource(fix.cx, fix.cy, fix.hFrac);
        const faceW        = fix.hFrac * FACE_ASPECT;
        const halfW        = faceW / 2;
        const leftOval     = z.ovals.find(o => o.side === 'left') || z.ovals[0];
        // gap = face left edge − inner right edge of left oval
        const faceLeftEdge  = fix.cx - halfW;
        const ovalInnerEdge = leftOval.cx + z.rx;
        const gap           = faceLeftEdge - ovalInnerEdge;
        const gapFW         = gap / faceW;
        assert.ok(
            gapFW >= 0.10,
            `gap ${gapFW.toFixed(3)} face-widths must be >= 0.10 (left oval inner edge ${ovalInnerEdge.toFixed(4)}, face left ${faceLeftEdge.toFixed(4)})`
        );
        assert.ok(
            gapFW <= 0.50,
            `gap ${gapFW.toFixed(3)} face-widths must be <= 0.50`
        );
    });
}
