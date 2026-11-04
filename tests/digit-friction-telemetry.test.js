// S204 digit-friction telemetry + near-distance coaching — guard tests.
//
// 1. PASS MARKS DID NOT MOVE: every client acceptance constant the digit step reads is pinned
//    here at its pre-S204 value. This change is telemetry + copy only; if one of these moves,
//    that is a separate decision for Rob, not a side effect of this lane.
// 2. Telemetry beams on every ceremony (no ?debug=1 gate) and never carries transcripts.
// 3. The word category helper returns only fixed labels (never the words themselves).
//
// Run: node --test tests/digit-friction-telemetry.test.js   (Node built-in runner, no deps)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
const fd = fs.readFileSync(path.join(ROOT, 'vac-finger-detect.js'), 'utf8');

function constOf(text, name) {
    const m = text.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, 'missing const ' + name);
    return Function('"use strict"; return (' + m[1] + ');')();
}
function fnSource(text, name) {
    const start = text.indexOf('function ' + name + '(');
    assert.ok(start >= 0, 'missing function ' + name);
    const end = text.indexOf('\n}\n', start);
    return text.slice(start, end + 2);
}

test('S204-DF-01: digit-step pass marks are unchanged', () => {
    const pinned = {
        STABLE_FRAMES_NEEDED: 12, MIN_DIGIT_DWELL_MS: 700, FINGER_RELEASE_SUSTAIN_MS: 300,
        CONFIRM_BEAT_MS: 900, DIGIT_VOICE_MIN_MS: 200, DIGIT_VOICE_GAP_MS: 200, DIGIT_MOD_DELTA: 0.030,
        VAD_ONSET_SUSTAIN_MS: 180, VAD_ONSET_DIP_MS: 60, VOICE_BAND_MIN_RATIO: 0.45,
        DIGIT_COOCCUR_MS: 700, DIGIT_COOCCUR_MAX_MS: 2000, NO_MATCH_FALLBACK_MS: 4000,
        VOICE_EVIDENCE_MIN_FRAMES: 8, FAST_DIGIT_VOICE_MIN_MS: 235,
    };
    for (const [k, v] of Object.entries(pinned)) assert.equal(constOf(src, k), v, k + ' moved');
    const pinnedFd = { THUMB_BEND_MAX: 48, THUMB_SPREAD_MIN: 0.42, FOUR_FINGER_BEND_MAX: 35,
        HYST_CHANGE_FRAMES: 5, HYST_CLEAR_FRAMES: 3, HYST_SETTLE_FRAMES: 4 };
    for (const [k, v] of Object.entries(pinnedFd)) assert.equal(constOf(fd, k), v, k + ' moved');
    // Zone acceptance geometry (fallback spec + the face-anchored formula) is untouched.
    assert.match(src, /rx: 0\.21,\s+\/\/ task-644/);
    assert.match(src, /ry: 0\.26,\s+\/\/ task-644/);
    assert.match(src, /minTipsInside: 2,/);
    assert.match(src, /let rx = Math\.max\(0\.17, 0\.22 \* wFrac\);/);
    assert.match(src, /const ry = Math\.max\(0\.22, 0\.30 \* hFrac\);/);
    // Content-gate vocabulary is unchanged (no new homophones: that would widen what is accepted).
    const map = src.match(/const _CONTENT_DIGIT_MAP = \{([\s\S]*?)\n\};/)[1].replace(/\/\/[^\n]*/g, '');
    const keys = [...map.matchAll(/'([a-z]+)':/g)].map(m => m[1]).sort();
    assert.deepEqual(keys, ['ate', 'eight', 'fife', 'five', 'for', 'fore', 'four', 'free', 'juan', 'nine', 'niner',
        'o', 'oh', 'one', 'seven', 'six', 'three', 'to', 'too', 'tree', 'tu', 'two', 'won', 'zero'].sort());
});

test('S204-DF-02: ceremony telemetry beams on every ceremony, fire-and-forget', () => {
    const beam = fnSource(src, '_beamCeremonyTelemetry');
    assert.doesNotMatch(beam, /_DEBUG_MODE/, 'beam must not be ?debug=1-gated any more');
    assert.match(beam, /keepalive: true/);
    assert.match(beam, /\.catch\(function\(\)\{\}\)/);
    assert.match(beam, /delete c\._shownAt/);
    assert.match(beam, /location\.pathname/);
    const code = beam.replace(/\/\/[^\n]*/g, '');   // comments may name what is excluded
    assert.doesNotMatch(code, /location\.search|location\.href|email|landmark|descriptor|transcript/i);
});

test('S204-DF-03: no transcript text in every-ceremony content-gate beacons', () => {
    for (const ev of ['content_gate_miss', 'content_gate_no_match_fallback']) {
        const line = src.split('\n').find(l => l.includes("vacDebug('" + ev + "'"));
        assert.ok(line, ev + ' beacon missing');
        assert.doesNotMatch(line, /transcript:/, ev + ' must not carry the transcript');
    }
    assert.match(src, /delete _safeInfo\.transcript;/);
});

test('S204-DF-04: word category is a fixed label, never the words', () => {
    const ctx = {};
    const map = src.match(/const _CONTENT_DIGIT_MAP = \{[\s\S]*?\n\};/)[0];
    const norm = fnSource(src, '_contentNormWord');
    const cat = fnSource(src, '_telemetryWordCategory');
    const f = Function(map + '\n' + norm + '\n' + cat + '\nreturn _telemetryWordCategory;')();
    assert.equal(f('tree', 3), 'number_expected');
    assert.equal(f('four', 3), 'number_other');
    assert.equal(f('fine', 5), 'other');      // "fine" is NOT an alias — recorded as other, not accepted
    assert.equal(f('', 5), 'none');
    assert.equal(f(null, 5), 'none');
    const labels = new Set(['number_expected', 'number_other', 'other', 'none']);
    for (const t of ['hello there', 'my email is a@b.c', '5', 'for', 'happy birthday to you']) {
        assert.ok(labels.has(f(t, 2)), 'unexpected label for ' + t);
    }
    void ctx;
});

test('S204-DF-05: device class and browser family are coarse buckets', () => {
    const dev = fnSource(src, '_telemetryDeviceClass');
    const br = fnSource(src, '_telemetryBrowserFamily');
    const run = (ua, tp) => Function('navigator', dev + '\n' + br +
        '\nreturn [_telemetryDeviceClass(), _telemetryBrowserFamily()];')({ userAgent: ua, maxTouchPoints: tp });
    const ipadOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    assert.deepEqual(run(ipadOS, 5), ['ipad', 'safari']);
    assert.deepEqual(run(ipadOS, 0), ['mac', 'safari']);
    assert.deepEqual(run('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1', 5), ['iphone', 'chrome']);
});

test('S204-DF-06: near-distance coaching is copy only', () => {
    const fr = src.slice(src.indexOf('checkHandFraming: function'), src.indexOf('checkHandFraming: function') + 3200);
    assert.match(fr, /Hold the screen a little further away/);
    // the bad-frame conditions that drive the banner are unchanged
    assert.match(fr, /const EDGE = 0\.08;/);
    assert.match(fr, /const tooBig {2}= \(\(maxX-minX\) > 0\.72 \|\| \(maxY-minY\) > 0\.78\);/);
    assert.match(src, /var _NEAR_DISTANCE_RX = 0\.17;/);
});
