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
            _detector = await mp.HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "GPU"
                },
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                runningMode: "VIDEO"
            });
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
    const THUMB_BEND_MAX   = 40;    // thumb joint-angle below this = straight
    const THUMB_SPREAD_MIN = 0.62;  // thumb tip spread above this = away from palm
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

    return {
        init: init,
        detect: detect,
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
