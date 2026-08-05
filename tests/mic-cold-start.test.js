// D-QUICKAUTH-MIC-COLD-START harness (task-quickauth-mic-ready)
//
// Structural assertions against vac-reauth-ceremony.js source to confirm the
// mic readiness gate is wired correctly:
//   1. The readiness constants (MIC_READY_CAL_MS, MIC_READY_TIMEOUT_MS) exist.
//   2. The _awaitMicReady helper exists and is async-safe (returns a Promise).
//   3. In beginStillCapture (fast path): "Preparing mic" label appears, and
//      _awaitMicReady is called BEFORE _voiceGate.start — so the speak prompt
//      never shows before readiness proof.
//   4. The calibration window (MIC_READY_CAL_MS >= 300ms) never consumes user
//      speech — it resolves before the gate arms and before the prompt shows.
//   5. Parity: renderGreeting (full path) guards on audioContext.state so the
//      same race is closed on both paths.
//
// Run: node --test tests/mic-cold-start.test.js   (no dependencies)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// Extract a `const NAME = <expr>;` value from source by name.
function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in source — harness diverged from ship`);
    return Function('"use strict"; return (' + m[1] + ');')();
}

// ── TC-MIC-C1: readiness constants present with correct values ─────────────────
test('TC-MIC-C1: MIC_READY_CAL_MS is present and >= 300ms (dedicated floor-calibration window)', () => {
    const v = constFromSource('MIC_READY_CAL_MS');
    assert.equal(typeof v, 'number', 'MIC_READY_CAL_MS must be a number');
    assert.ok(v >= 300, `MIC_READY_CAL_MS=${v} must be >= 300ms (enough for EMA floor to settle)`);
    assert.ok(v <= 600, `MIC_READY_CAL_MS=${v} must be <= 600ms (user shouldn't wait more than this)`);
});

test('TC-MIC-C2: MIC_READY_TIMEOUT_MS is present and >= 1500ms', () => {
    const v = constFromSource('MIC_READY_TIMEOUT_MS');
    assert.equal(typeof v, 'number', 'MIC_READY_TIMEOUT_MS must be a number');
    assert.ok(v >= 1500, `MIC_READY_TIMEOUT_MS=${v} must be >= 1500ms (long enough for slow browsers)`);
});

// ── TC-MIC-C3: _awaitMicReady function exists in source ──────────────────────
test('TC-MIC-C3: _awaitMicReady function is defined in source', () => {
    assert.ok(
        /function _awaitMicReady\s*\(/.test(src),
        '_awaitMicReady function definition must be present in vac-reauth-ceremony.js'
    );
});

// ── TC-MIC-C4: _awaitMicReady returns a Promise (new Promise in body) ─────────
test('TC-MIC-C4: _awaitMicReady returns a Promise', () => {
    // Extract the function body and check it contains "new Promise"
    const m = src.match(/function _awaitMicReady\s*\([^)]*\)\s*\{([\s\S]*?)^}/m);
    // Fallback: just check the string appears after the function declaration
    const fnIdx = src.indexOf('function _awaitMicReady');
    assert.ok(fnIdx !== -1, '_awaitMicReady function not found');
    const fnSlice = src.slice(fnIdx, fnIdx + 600);
    assert.ok(fnSlice.includes('new Promise'), '_awaitMicReady must return a new Promise');
});

// ── TC-MIC-C5: fast path shows "Preparing mic" BEFORE the voice gate starts ───
test('TC-MIC-C5: "Preparing mic" label is set before _voiceGate.start in beginStillCapture', () => {
    const fnIdx = src.indexOf('async function beginStillCapture');
    assert.ok(fnIdx !== -1, 'beginStillCapture function not found');
    // Find the next occurrence of the two markers after the function start
    const prepIdx = src.indexOf('Preparing mic', fnIdx);
    const startIdx = src.indexOf('_voiceGate.start(audioAnalyser)', fnIdx);
    assert.ok(prepIdx !== -1, '"Preparing mic" text not found in beginStillCapture');
    assert.ok(startIdx !== -1, '_voiceGate.start call not found in beginStillCapture');
    assert.ok(
        prepIdx < startIdx,
        `"Preparing mic" label (offset ${prepIdx}) must appear before _voiceGate.start (offset ${startIdx}) in beginStillCapture`
    );
});

// ── TC-MIC-C6: _awaitMicReady is called BEFORE _voiceGate.start in fast path ─
test('TC-MIC-C6: _awaitMicReady is called before _voiceGate.start in beginStillCapture', () => {
    const fnIdx = src.indexOf('async function beginStillCapture');
    assert.ok(fnIdx !== -1, 'beginStillCapture function not found');
    const awaitIdx = src.indexOf('await _awaitMicReady(', fnIdx);
    const startIdx = src.indexOf('_voiceGate.start(audioAnalyser)', fnIdx);
    assert.ok(awaitIdx !== -1, 'await _awaitMicReady() call not found in beginStillCapture');
    assert.ok(startIdx !== -1, '_voiceGate.start call not found in beginStillCapture');
    assert.ok(
        awaitIdx < startIdx,
        `await _awaitMicReady (offset ${awaitIdx}) must appear before _voiceGate.start (offset ${startIdx})`
    );
});

// ── TC-MIC-C7: calibration window only fires AFTER AudioContext is running ────
test('TC-MIC-C7: _awaitMicReady polls for ctx.state !== "running" before starting calMs window', () => {
    const fnIdx = src.indexOf('function _awaitMicReady');
    assert.ok(fnIdx !== -1, '_awaitMicReady not found');
    // Extract body by finding the closing brace that matches the opening brace of the function.
    // Robust to async/non-async siblings — does not rely on "\nfunction" boundary matching.
    let depth = 0, fnEnd = -1;
    for (let i = fnIdx; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
    }
    assert.ok(fnEnd > fnIdx, '_awaitMicReady closing brace not found');
    const body = src.slice(fnIdx, fnEnd);
    assert.ok(body.includes("ctx.state !== 'running'"), '_awaitMicReady must gate on ctx.state !== "running"');
    assert.ok(body.includes('_calStart'), '_awaitMicReady must track calibration window start (_calStart)');
    assert.ok(body.includes('calMs'), '_awaitMicReady must use calMs for the calibration window length');
    // Additional: check ghost-session guard (closed context exits immediately)
    assert.ok(body.includes("ctx.state === 'closed'"), '_awaitMicReady must resolve immediately when context is closed (ghost-session guard)');
    // Additional: check one-shot resume guard (no resume spam)
    assert.ok(body.includes('_resumeRequested'), '_awaitMicReady must use one-shot resume flag to prevent iOS WebKit resume spam');
});

// ── TC-MIC-C8: parity — renderGreeting guards on audioContext.state (full path) ─
test('TC-MIC-C8: renderGreeting (full path) guards on audioContext.state before showing speak prompt', () => {
    const fnIdx = src.indexOf('function renderGreeting()');
    assert.ok(fnIdx !== -1, 'renderGreeting function not found');
    const fnSlice = src.slice(fnIdx, fnIdx + 1500);
    assert.ok(
        fnSlice.includes("audioContext.state !== 'running'"),
        'renderGreeting must guard on audioContext.state !== "running" (parity with fast path)'
    );
    assert.ok(
        fnSlice.includes("audioContext.resume"),
        'renderGreeting must call audioContext.resume() when suspended'
    );
    assert.ok(
        fnSlice.includes('Preparing mic'),
        'renderGreeting must show "Preparing mic" when AudioContext is not yet running'
    );
    // TC-MIC-C8b: 3s fallthrough prevents permanent "Preparing mic" on stuck AudioContext.
    // Guard must include elapsedMs < 3000 so a permanently suspended context doesn't block forever.
    assert.ok(
        fnSlice.includes('elapsedMs < 3000'),
        'renderGreeting guard must fall through after 3s (elapsedMs < 3000) to prevent infinite "Preparing mic" on stuck AudioContext'
    );
});

// ── TC-MIC-C9: gate instrumentation present (L-2173 runtime datum) ────────────
test('TC-MIC-C9: _awaitMicReady emits diagnostic vacDebug events for field tracing', () => {
    const fnIdx = src.indexOf('function _awaitMicReady');
    const fnEnd = src.indexOf('\nfunction ', fnIdx + 1);
    const body = src.slice(fnIdx, fnEnd > 0 ? fnEnd : fnIdx + 2000);
    assert.ok(body.includes('mic_ready_wait_start'), 'must emit mic_ready_wait_start (timestamps stream.active + ctx.state)');
    assert.ok(body.includes('mic_ready_ctx_running'), 'must emit mic_ready_ctx_running (how long ctx suspension lasted)');
    assert.ok(body.includes('mic_ready_done'), 'must emit mic_ready_done (total elapsed + settled floor)');
});

// ── TC-MIC-C9b: ghost-session guard — return early if audioAnalyser null after await ─
test('TC-MIC-C9b: beginStillCapture returns early if audioAnalyser is null after _awaitMicReady', () => {
    const fnIdx = src.indexOf('async function beginStillCapture');
    assert.ok(fnIdx !== -1, 'beginStillCapture not found');
    const awaitIdx = src.indexOf('await _awaitMicReady(', fnIdx);
    assert.ok(awaitIdx !== -1, 'await _awaitMicReady not found');
    // After the await, there must be an audioAnalyser null-check + return
    const afterAwait = src.slice(awaitIdx, awaitIdx + 500);
    assert.ok(
        afterAwait.includes('!audioAnalyser') && afterAwait.includes('return'),
        'beginStillCapture must check !audioAnalyser after _awaitMicReady and return early (ghost-session guard)'
    );
});

// ── TC-MIC-C10: step2Title assignment with "say the number" follows the gate ───
test('TC-MIC-C10: textContent "say the number" step2Title assignment appears AFTER _voiceGate.start', () => {
    const fnIdx = src.indexOf('async function beginStillCapture');
    assert.ok(fnIdx !== -1, 'beginStillCapture not found');
    const startIdx = src.indexOf('_voiceGate.start(audioAnalyser)', fnIdx);
    // Search for the JS assignment (not a comment): textContent = ... 'Show your fingers and say the number'
    const promptIdx = src.indexOf("'Show your fingers and say the number'", fnIdx);
    assert.ok(startIdx !== -1, '_voiceGate.start not found in beginStillCapture');
    assert.ok(promptIdx !== -1, "step2Title speak-prompt assignment not found in beginStillCapture");
    assert.ok(
        promptIdx > startIdx,
        `step2Title assignment (offset ${promptIdx}) must appear AFTER _voiceGate.start (offset ${startIdx}) — the gate must arm before the prompt shows`
    );
});
