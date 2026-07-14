// ── VAC shared finger/hand detector ─────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for VAC's real-time finger counting. Lifted verbatim
// from auth.html's FingerDetector (S110, validated live at /finger-test) so the
// full auth flow, the quick re-auth (vat-verify.html) and the test bench
// (finger-test.html) all run the EXACT same math — no merged/averaged variants.
//
//   thumb     : joint-angle (CMC→MCP vs MCP→TIP) < 40°  AND  spread > 0.62
//   four fing : bend angle (base→pip vs pip→tip)   < 35° = extended
//
// Orientation-invariant (vector-angle, not tip.y<pip.y) so the count survives
// the hand being upright, sideways or tilted. MediaPipe HandLandmarker with a
// warm-up grace period + consecutive-slow-frame fallback + reset latch-clear.
//
// TARGET-AGNOSTIC: detect()/countFingers() return the raw variable count 0-5.
// Callers supply the expected digit(s) — no target number is hardcoded here.
//
// Loaded as a plain <script> (like vac-face-embed.js); defines window.FingerDetector.
// vacDebug() calls are wrapped in try/catch so this no-ops telemetry on pages
// (vat-verify.html, finger-test.html) where vacDebug is not defined.
window.FingerDetector = (function() {
    let _detector = null;
    let _isReady = false;
    let _hasFailed = false;
    let _framesProcessed = 0;
    let _consecutiveSlowFrames = 0;
    let _lastLandmarks = null;
    // Mobile first-frame cost (GPU shader compile, WASM JIT warmup) can spike
    // to 800-1500ms. Give it a warm-up grace period and require *sustained*
    // slowness before giving up — not a single bad frame.
    const WARMUP_FRAMES = 5;                      // ignore timing for first 5 frames
    const SLOW_FRAME_MS = 1500;                   // what counts as "too slow"
    const CONSECUTIVE_SLOW_LIMIT = 6;             // how many in a row before we bail (raised from 3 — fallback is permanent, so don't trip on transient hiccups)

    // ── F-613: asymmetric finger-count HYSTERESIS (cross-LLM gated, S118) ────────
    // Problem: MediaPipe finger count flickers (a steady "1" reads 1,3,1,1,3…),
    // so the old "12 consecutive identical frames" rule starved on flicker and
    // forced unnatural stillness (the #1 adoption complaint). Fix: hold an
    // established count THROUGH brief flicker; only change on a SUSTAINED new
    // reading. Cheap to hold, expensive to change.
    //
    // CHANGE_FRAMES is tuned ABOVE MediaPipe's typical 4-7 frame error burst
    // (cross-LLM finding) so a burst can't false-commit. Hand-loss (-1) clears
    // FASTER than a count change (asymmetric the other way) so a stale count
    // can't be held alive by brief occlusion. SETTLE_FRAMES gates the FIRST
    // commit so continuous flicker can't commit an early-wrong value.
    //
    // CRITICAL (gated): detectStable() smooths the DISPLAY/timing count. It does
    // NOT replace raw detect(). Callers MUST read the RAW count at the capture
    // instant and send THAT to the server — the server (Gemini/sequence) is the
    // real gate. Never let the smoothed value drive what is sent as truth, or a
    // 2→3 change reported as stale 2 would capture the wrong gesture.
    const HYST_CHANGE_FRAMES = 5;   // sustained frames a NEW count must hold to win (> burst length)
    const HYST_CLEAR_FRAMES  = 3;   // sustained -1 frames before we report "no hand" (faster than a change)
    const HYST_SETTLE_FRAMES = 4;   // min frames before the FIRST commit (init-race guard)
    let _hystCommitted = null;      // currently reported count (null = not yet settled)
    let _hystCandidate = null;      // a different value trying to take over
    let _hystStreak = 0;            // consecutive frames the candidate has persisted

    async function init() {
        if (_isReady || _hasFailed) return _isReady;
        const _initStart = performance.now();
        try { vacDebug('fd_init_start'); } catch(_) {}
        try {
            // Wait for the ES-module import at top of <head> to finish.
            // That import sets window.__VAC_MediaPipe. Module loads are async
            // and can take 500-3000ms on 4G — don't race it, wait for it.
            const MODULE_POLL_MS = 100;
            const MODULE_MAX_WAIT_MS = 15000;  // 15s budget for CDN download
            let waited = 0;
            while (!window.__VAC_MediaPipe && waited < MODULE_MAX_WAIT_MS) {
                await new Promise(r => setTimeout(r, MODULE_POLL_MS));
                waited += MODULE_POLL_MS;
            }
            const mp = window.__VAC_MediaPipe;
            if (!mp) {
                _hasFailed = true;
                try { vacDebug('fd_init_no_module', 'Waited ' + MODULE_MAX_WAIT_MS + 'ms, window.__VAC_MediaPipe never set', { module_error: window.__VAC_MediaPipe_error || null, waited_ms: waited }); } catch(_) {}
                console.warn('[VAC] HandLandmarker init: MediaPipe module did not load within ' + MODULE_MAX_WAIT_MS + 'ms (check network/CSP for cdn.jsdelivr.net)');
                return false;
            }
            try { vacDebug('fd_init_module_ready', null, { module_wait_ms: waited, module_load_ms: window.__VAC_MediaPipe_load_ms || null }); } catch(_) {}
            if (waited > 0) {
                console.log('[VAC] HandLandmarker init: waited ' + waited + 'ms for MediaPipe module to load');
            }
            const visionStart = performance.now();
            const vision = await mp.FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );
            try { vacDebug('fd_init_wasm_loaded', null, { ms: Math.round(performance.now() - visionStart) }); } catch(_) {}
            const modelStart = performance.now();
            // F-788: MODEL-SOURCE RESILIENCE. The model previously loaded ONLY from
            // storage.googleapis.com with NO timeout — on travel/hotel/corporate networks that
            // fetch stalls forever (live telemetry S134: fd_init_wasm_loaded fired, fd_init_ready
            // never did, no exception -> createFromOptions hung on the model download; the whole
            // pre-flight blocked). Order now: (1) same-origin /models/hand_landmarker.task
            // (self-hosted on vacprotocol.org — immune to third-party blocks; 404s instantly if
            // not yet vendored), then (2) the Google CDN. Each attempt is timeout-wrapped so a
            // stalled network FAILS FAST with telemetry instead of hanging the ceremony.
            const _mkDetector = function(url){ return mp.HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: url, delegate: "GPU" },
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                runningMode: "VIDEO"
            }); };
            // F-788a STALL-AWARE MODEL FETCH (Rob, Gatwick Express: "slow internet users are
            // real users — should still work"). Fixed total-time timeouts KILL slow-but-working
            // downloads; the correct failure signal is a STALL (no bytes for _STALL_MS), never
            // total duration. Stream the model with progress telemetry, then feed
            // createFromOptions a local blob URL (instant). /models/* is served immutable
            // (vercel.json) so the 7.5MB costs each browser ONCE, ever.
            const _fetchModelBlob = async function(url){
                const _STALL_MS = 12000;
                const resp = await Promise.race([
                    fetch(url, { cache: 'force-cache' }),
                    new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('connect_stall')); }, _STALL_MS); })
                ]);
                if (!resp.ok) throw new Error('http_' + resp.status);
                if (!resp.body || !resp.body.getReader) { return URL.createObjectURL(await resp.blob()); }
                const reader = resp.body.getReader();
                const chunks = []; let got = 0; let lastBeat = performance.now();
                const total = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
                while (true) {
                    const r = await Promise.race([
                        reader.read(),
                        new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('stall_at_' + got + 'b')); }, _STALL_MS); })
                    ]);
                    if (r.done) break;
                    chunks.push(r.value); got += r.value.length; lastBeat = performance.now();
                    try { if (FingerDetector.onModelProgress) FingerDetector.onModelProgress(got, total); } catch(_) {}
                }
                return URL.createObjectURL(new Blob(chunks));
            };
            const _MODEL_SOURCES = [
                { url: (location.origin || '') + '/models/hand_landmarker.task', tag: 'same_origin' },
                { url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", tag: 'google_cdn' }
            ];
            let _lastErr = null;
            for (let _mi = 0; _mi < _MODEL_SOURCES.length && !_detector; _mi++) {
                const _src = _MODEL_SOURCES[_mi];
                try {
                    const _blobUrl = await _fetchModelBlob(_src.url);
                    try {
                        _detector = await _mkDetector(_blobUrl);
                        try { vacDebug('fd_model_source', _src.tag, { ms: Math.round(performance.now() - modelStart) }); } catch(_) {}
                    } finally { try { URL.revokeObjectURL(_blobUrl); } catch(_) {} }
                } catch (me) {
                    _lastErr = me;
                    try { vacDebug('fd_model_source_failed', _src.tag + ': ' + ((me && me.message) || String(me))); } catch(_) {}
                }
            }
            if (!_detector) throw (_lastErr || new Error('all_model_sources_failed'));
            _isReady = true;
            try { vacDebug('fd_init_ready', null, { model_ms: Math.round(performance.now() - modelStart), total_ms: Math.round(performance.now() - _initStart) }); } catch(_) {}
            console.log('[VAC] HandLandmarker ready — real-time finger detection active');
            return true;
        } catch(e) {
            _hasFailed = true;
            try { vacDebug('fd_init_exception', e && e.message || String(e), { name: e && e.name || null, total_ms: Math.round(performance.now() - _initStart) }); } catch(_) {}
            console.warn('[VAC] HandLandmarker unavailable, will use timer fallback:', e.message);
            return false;
        }
    }

    // Orientation-invariant finger count (S110, validated live at /finger-test).
    // Replaces the old tip.y<pip.y check which only worked with the hand upright.
    // A finger is "extended" when its two segments (base->mid, mid->tip) stay roughly
    // aligned (small bend angle) regardless of hand orientation in the image plane.
    function _angle(a,b,c){
        const v1={x:b.x-a.x,y:b.y-a.y}, v2={x:c.x-b.x,y:c.y-b.y};
        const dot=v1.x*v2.x+v1.y*v2.y, m1=Math.hypot(v1.x,v1.y), m2=Math.hypot(v2.x,v2.y);
        if(m1===0||m2===0) return 180;
        let cos=dot/(m1*m2); cos=Math.max(-1,Math.min(1,cos));
        return Math.acos(cos)*180/Math.PI; // 0 = straight, larger = bent
    }

    // Canonical thresholds — the live-tested auth.html values. Source of truth.
    const THUMB_BEND_MAX   = 48;    // F-766b: 45->48° — Rob live: natural 5 still read 4 at 45; a bit more headroom
    const THUMB_SPREAD_MIN = 0.42;  // F-766b: 0.50->0.42 — natural 5 still under-counted at 0.50; 4 confirmed still reads 4, so margin exists. Tucked thumb sits well below 0.42 spread so a genuine 4 stays safe. If a tucked-4 ever reads 5, this went one step too far.
    const FOUR_FINGER_BEND_MAX = 35; // four-finger bend below this = extended
    const F = [[5,6,8],[9,10,12],[13,14,16],[17,18,20]]; // index..pinky [mcp,pip,tip]

    // Per-finger detail — single implementation behind both the live count and the
    // test bench's readout. `fourFingerThreshold` defaults to the canonical 35;
    // only the finger-test bench passes its tuning slider. The thumb test is always
    // the fixed canonical 40°/0.62 (the bench never tuned the thumb).
    function _countDetailed(lm, fourFingerThreshold){
        const thr = (typeof fourFingerThreshold === 'number') ? fourFingerThreshold : FOUR_FINGER_BEND_MAX;
        let count = 0; const states = [];
        // thumb: joint-angle + spread (validated: 25 deg / 0.67 spread reads "up")
        const tBend = _angle(lm[1],lm[2],lm[4]);
        const wrist = lm[0], scale = Math.hypot(lm[9].x-wrist.x, lm[9].y-wrist.y) || 1;
        const tSpread = Math.hypot(lm[4].x-lm[5].x, lm[4].y-lm[5].y)/scale;
        const tUp = tBend < THUMB_BEND_MAX && tSpread > THUMB_SPREAD_MIN;
        states.push({ up: tUp, metric: tBend, spread: tSpread, isThumb: true });
        if (tUp) count++;
        // four fingers: bend angle of base->pip vs pip->tip, < threshold = extended
        for (const [mcp,pip,tip] of F){
            const a = _angle(lm[mcp],lm[pip],lm[tip]);
            const up = a < thr;
            states.push({ up, metric: a, isThumb: false });
            if (up) count++;
        }
        return { count, states };
    }

    // Raw variable count 0-5 at the canonical thresholds. Used by the live loops.
    function _countFingers(lm) {
        return _countDetailed(lm).count;
    }

    function detect(videoEl) {
        if (!_isReady || _hasFailed || !_detector) return null;
        const t0 = performance.now();
        let results;
        try {
            results = _detector.detectForVideo(videoEl, performance.now());
        } catch(e) {
            console.warn('[VAC] HandLandmarker detect error, switching to timer fallback:', e.message);
            _hasFailed = true;
            return null;
        }
        const ms = performance.now() - t0;
        _framesProcessed++;
        if (_framesProcessed > WARMUP_FRAMES) {
            if (ms > SLOW_FRAME_MS) {
                _consecutiveSlowFrames++;
                if (_consecutiveSlowFrames >= CONSECUTIVE_SLOW_LIMIT) {
                    console.warn('[VAC] HandLandmarker too slow (' + CONSECUTIVE_SLOW_LIMIT + ' consecutive frames > ' + SLOW_FRAME_MS + 'ms, last=' + ms.toFixed(0) + 'ms), switching to timer fallback');
                    _hasFailed = true;
                    return null;
                }
            } else {
                _consecutiveSlowFrames = 0;
            }
        }
        if (!results.landmarks || results.landmarks.length === 0) { _lastLandmarks = null; return -1; } // no hand in frame
        _lastLandmarks = results.landmarks[0];
        return _countFingers(results.landmarks[0]);
    }

    // ── F-613: feed a raw reading through the hysteresis filter ──────────────
    // Returns the SMOOTHED count for display/timing. raw is the per-frame value
    // from detect(): 0-5 = fingers, -1 = no hand, null = detector unavailable.
    // null is passed through untouched (caller decides). Asymmetric: a matching
    // reading confirms instantly; a different reading must persist CHANGE_FRAMES
    // to win; -1 (no hand) clears after the shorter CLEAR_FRAMES.
    function _feedHysteresis(raw) {
        if (raw === null) return _hystCommitted;      // detector down — report last known, don't churn state

        // Pre-settle: require the candidate to PERSIST (a real streak), not just
        // elapsed frames, before the FIRST commit — so continuous flicker
        // (1,3,1,3…) can't lock in an early-wrong value (cross-LLM init-race).
        if (_hystCommitted === null) {
            if (raw < 0) { _hystCandidate = null; _hystStreak = 0; return null; } // no hand yet
            if (_hystCandidate === raw) { _hystStreak++; } else { _hystCandidate = raw; _hystStreak = 1; }
            if (_hystStreak >= HYST_SETTLE_FRAMES) {
                _hystCommitted = raw; _hystCandidate = null; _hystStreak = 0;
            }
            return _hystCommitted; // null until a value holds steady for SETTLE_FRAMES
        }

        // No-hand: clears FASTER than a count change (occlusion can't hold a stale value).
        if (raw < 0) {
            if (_hystCandidate === -1) { _hystStreak++; } else { _hystCandidate = -1; _hystStreak = 1; }
            if (_hystStreak >= HYST_CLEAR_FRAMES) { _hystCommitted = -1; _hystCandidate = null; _hystStreak = 0; }
            return _hystCommitted;
        }

        // Matches committed → confirm instantly, reset any pending candidate (steadiness is free).
        if (raw === _hystCommitted) { _hystCandidate = null; _hystStreak = 0; return _hystCommitted; }

        // Differs → candidate must persist CHANGE_FRAMES (above MediaPipe burst) to win; else absorb the flicker.
        if (_hystCandidate === raw) { _hystStreak++; } else { _hystCandidate = raw; _hystStreak = 1; }
        if (_hystStreak >= HYST_CHANGE_FRAMES) { _hystCommitted = raw; _hystCandidate = null; _hystStreak = 0; }
        return _hystCommitted; // old committed until the change is sustained
    }

    return {
        init: init,
        detect: detect,
        // F-613: smoothed count for DISPLAY/timing. Internally calls raw detect()
        // then filters. Callers needing the value-of-record at capture MUST still
        // read detect() (raw) at the capture instant and send that to the server.
        detectStable(videoEl) { return _feedHysteresis(detect(videoEl)); },
        // F-613: for callers that ALREADY called detect() this frame — feed the raw
        // value through the same hysteresis filter WITHOUT running MediaPipe again
        // (detectStable would double-detect). Pass the raw count from detect().
        feedStable(raw) { return _feedHysteresis(raw); },
        // F-613: reset the hysteresis filter between attempts/digits (so a new
        // run/digit starts clean — no stale committed count bleeding across).
        resetHysteresis() { _hystCommitted = null; _hystCandidate = null; _hystStreak = 0; },
        get landmarks() { return _lastLandmarks; },
        get ready() { return _isReady; },
        get failed() { return _hasFailed; },
        // S110 fix: clear the slow-frame latch so a 2nd auth attempt re-engages
        // detection instead of staying stuck in timer fallback. _detector + the
        // loaded model are preserved; only the per-run failure flags reset.
        reset() {
            if (_detector && !_hasFailed) { /* already healthy, nothing to do */ }
            _hasFailed = false;
            _consecutiveSlowFrames = 0;
            _framesProcessed = 0;
            _lastLandmarks = null;
            // F-613: also clear the hysteresis filter so a new attempt starts clean.
            _hystCommitted = null; _hystCandidate = null; _hystStreak = 0;
        },
        // Guarded one-shot warm-up (toggle-gated, S110). Swallows all errors so it
        // can NEVER trip the failure latch or affect the real loop's state.
        warmOnce(videoEl, ts) {
            if (!_isReady || !_detector || !videoEl || videoEl.readyState < 2) return;
            try { _detector.detectForVideo(videoEl, ts); } catch(_) { /* warm-up must never fail the detector */ }
        },
        // ── Stateless geometry helpers (no detector/MediaPipe state) ─────────────
        // For callers that drive their own landmarker loop (e.g. the finger-test
        // bench) and want the SAME counting math without the warm-up/fallback
        // machinery. countDetailed() exposes the per-finger breakdown + a tunable
        // four-finger threshold; angle()/countFingers() mirror the live values.
        angle: _angle,
        countFingers: _countFingers,
        countDetailed: _countDetailed
    };
})();
