// vac-reauth-ceremony.js
// VAC re-auth ceremony — the ONE shared "show-and-say N digits while the face is verified"
// flow, extracted VERBATIM from auth.html (S117 reauth-unify, STEP 1). Behaviour is identical to
// auth.html's inline ceremony; only the seams (identity, risk level, success/retry handoff) are
// parameterised. Exposes window.VACReauth.run({email,name,riskLevel,mount,context,onComplete,
// onFallback,onReauthReload,onBack,onStep,auto,profile}). auth.html is the first/only caller;
// vat-verify + tribunal-demo adopt it in STEP 2/3. `profile` is the COPS/PID policy actuator
// (num_digits live today; required_modalities + thresholds reserved for the policy engine).
(function(){
'use strict';

const API_BASE = 'https://vac-system-production.up.railway.app';

// Per-run context: identity, risk level, mount, host callbacks. Set by VACReauth.run().
let CTX = null;
let currentStep = 0;

// ?qa=1 debug overlay: captured from the host (window.QA) at run() time if present; a no-op shim
// otherwise, so the ceremony runs identically on hosts that don't have the overlay.
const _QA_SHIM = { on:false, onEvent:function(){}, frame:function(){}, cal:function(){} };
let QA = _QA_SHIM;
// F-763c/e: self-enable QA at MODULE INIT from ?qa=1. The ceremony runs INSIDE an iframe (#voFrame)
// whose own URL has no ?qa=1 — the flag is on the PARENT page URL. Check both the iframe's own search
// AND the parent (same-origin, so window.top is readable). Dev-only; real users never pass ?qa=1.
try {
    var _qaFlag = false;
    try { if (new URLSearchParams(window.location.search).get('qa') === '1') _qaFlag = true; } catch(_) {}
    try { if (!_qaFlag && window.top && window.top !== window && new URLSearchParams(window.top.location.search).get('qa') === '1') _qaFlag = true; } catch(_) {}
    try { if (!_qaFlag && document.referrer && document.referrer.indexOf('qa=1') !== -1) _qaFlag = true; } catch(_) {}
    if (_qaFlag) QA = { on:true, onEvent:function(){}, frame:function(){}, cal:function(){} };
} catch(_) {}

// Identity for the moved ceremony code (was auth.html's form-reading userData()).
function userData(){ return (CTX && CTX.identity) || { name:'', email:'', org:'', role:'' }; }

// ── F-624 Rung 2: declarative fast/full MODE actuator ────────────────────────
// VACReauth.run drives ONE ceremony; the active MODE selects the endpoints and the
// capture kind at each of the THREE call sites (challenge / capture / verify). It is
// a config MAP, not an if/else fork — Rung-3 (per-tenant policy) slots in as another
// key without re-touching the call sites (per F-624). FULL is today's behaviour
// byte-for-byte (auth.html, the only current caller); FAST is the lightweight
// still+digit quick re-auth that vat-verify / tribunal adopt in later lanes.
//   challenge: { method, url(d), buildBody(d) }  buildBody → object = JSON body; null = no body (GET)
//   capture:   { kind: 'clip' | 'still' }
//   verify:    { method, url(), buildBody(parts) }  buildBody → FormData = multipart; object = JSON
const MODE_CONFIG = {
    full: {
        challenge: {
            method: 'POST',
            url: function(){ return API_BASE + '/v1/vat/auth/challenge'; },
            // Identical to the pre-Rung-2 inline body: name + risk_level, plus the
            // optional num_digits profile actuator (S117 reauth-count). Omitted field
            // → server decides the digit count (prod behaviour intact).
            buildBody: function(d){
                const body = { name: d.name, risk_level: CTX.riskLevel };
                if (CTX.profile && typeof CTX.profile.num_digits === 'number') {
                    body.num_digits = CTX.profile.num_digits;
                }
                // F-648: the SEAL-GATE lighter re-auth (greeting:skip — the ONLY caller that sets
                // it, via tribunal seal -> auth.html?greeting=skip) is NAME-LESS. Tell the backend
                // to build a digits-only challenge phrase so the user speaks ONLY the fresh
                // per-session random digits (the anti-replay anchor) — no "I am {name}". The scorer
                // CORE becomes the digits (UNORDERED set-overlap at 0.80), so a digits-only read
                // scores 1.0 and a replay whose digit SET differs fails — same digit-set strength as
                // the prior name-bearing seal-gate (the name was a constant). The spoken name was
                // never a real identity proof (a known string); /verify gates on liveness + the fresh
                // challenge, and the seal/session layer binds the owner. First auth (profile null /
                // no greeting:skip) omits the flag -> identity phrase unchanged.
                if (CTX.profile && CTX.profile.greeting === 'skip') {
                    body.nameless = true;
                }
                return body;
            },
        },
        capture: { kind: 'clip' },
        verify: {
            method: 'POST',
            url: function(){ return API_BASE + '/v1/vat/auth/verify'; },
            // FULL verify sends the multipart A/V clip built at the call site; the
            // FormData is handed back verbatim so the request is byte-identical to today.
            buildBody: function(parts){ return parts.formData; },
        },
    },
    fast: {
        challenge: {
            method: 'GET',
            url: function(d){ return API_BASE + '/v1/auth/face-reauth-challenge?email=' + encodeURIComponent((d && d.email) || ''); },
            buildBody: function(){ return null; },   // GET — no request body
        },
        capture: { kind: 'still' },
        verify: {
            method: 'POST',
            url: function(){ return API_BASE + '/v1/auth/quick-reauth'; },
            // FAST verify is a small JSON envelope: the bound still + the single
            // detected finger count, keyed by email. No video, no multipart.
            buildBody: function(parts){
                return {
                    email: (parts && parts.email) || userData().email,
                    // F-731: thread the challenge_id so the server looks up the digit by this id
                    // (not by email single-slot), preventing the rapid-retry race condition.
                    challenge_id: (parts && parts.challenge_id != null) ? parts.challenge_id : (challengeData && challengeData.challenge_id) || '',
                    detected_fingers: (parts && parts.detected_fingers != null) ? parts.detected_fingers : null,
                    face_still_b64: (parts && parts.face_still_b64 != null) ? parts.face_still_b64 : (window.__vacFaceStillB64 || ''),
                    // F-637c: LIVE 128-D identity descriptor (face-api.js), single-face enforced
                    // upstream in beginStillCapture. The server runs its euclidean identity check
                    // (live vs stored enroll) on this — omitting it was why quick-reauth failed at
                    // embedding_invalid every time. RAW array in this JSON envelope (the FULL path
                    // JSON.stringifies only because it appends to FormData). In practice this is
                    // always the live vector: the only path with no descriptor fails closed in
                    // beginStillCapture + is re-checked in runFastVerification, so verify is never
                    // reached with a null embedding. The `: null` is a defensive floor, not a route.
                    face_embedding: (parts && parts.face_embedding != null) ? parts.face_embedding : null,
                    // F-654: the SAID half of the bound digit (Deepgram) + the still's offset into the
                    // clip (co-occurrence proof). Empty audio → server bound-digit gate fails closed.
                    spoken_audio_b64: (parts && parts.spoken_audio_b64 != null) ? parts.spoken_audio_b64 : '',
                    still_ts_ms: (parts && parts.still_ts_ms != null) ? parts.still_ts_ms : null,
                };
            },
        },
    },
};

// Resolve the active mode's config for THIS run. This IS the `MODE_CONFIG[CTX.profile.mode
// || "full"]` lookup the task specifies, with an unknown-key fallback to full. The default
// is the REGRESSION GUARD: any caller that omits profile.mode (auth.html) gets today's full
// ceremony unchanged — fast is opt-in, never reached unless a host explicitly sets it.
function modeConfig(){
    const m = (CTX && CTX.profile && CTX.profile.mode) || 'full';
    return MODE_CONFIG[m] || MODE_CONFIG.full;
}

// Self-contained telemetry (was auth.html's vacDebug): POSTs to /v1/auth/debug + fans to the
// ?qa=1 overlay if the host exposed one. Best-effort; never blocks the ceremony.
const VAC_DEBUG_SESSION = 'sess_' + Math.random().toString(36).slice(2, 10) + '_reauth';
function vacDebug(event, reason, context) {
    try {
        const body = { session_id: VAC_DEBUG_SESSION, event: String(event) };
        if (reason !== undefined && reason !== null) body.reason = String(reason);
        if (context) { try { body.context = context; } catch(_) {} }
        fetch(API_BASE + '/v1/auth/debug', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body), keepalive:true }).catch(function(){});
        try { if (QA && QA.on) QA.onEvent(event, context); } catch(_) {}
        console.log('[VAC-DBG]', event, reason || '', context || '');
    } catch(_) {}
}

// ── module step navigation (replaces auth.html goToStep for the ceremony's steps 1-3, scoped to
//    the mount). Fires CTX.onStep(n) so the host can mirror its own progress dots. ──
function goToStep(n){
    try { var _ci=document.getElementById('challengeIntro'); if(_ci) _ci.style.display='none'; } catch(_){}
    if (CTX && CTX.mount){
        CTX.mount.querySelectorAll('.step-section').forEach(function(s){ s.classList.remove('active'); });
        var el = document.getElementById('step'+n);
        if (el) el.classList.add('active');
    }
    if (CTX && CTX.onStep){ try { CTX.onStep(n); } catch(_){} }
    currentStep = n;
}

// Terminal SUCCESS path — hand the LIVE verify result back to the host (was auth.html showSuccess()).
function _finish(){
    try { if (CTX && CTX.mount) CTX.mount.style.display='none'; } catch(_){}
    if (CTX && CTX.onComplete){ try { CTX.onComplete(authResult); } catch(e){ console.error('[VACReauth] onComplete error', e); } }
}



// ========== ceremony state (auth.html globals) ==========

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let _recorderStartMs = 0;       // F-720: performance.now() at MediaRecorder.start()
let _legitStopScheduled = false; // F-720: true only when finishFingerPhase schedules the stop
let authResult = null;
let challengeData = null;
let fingerFallback = 'none';
let challengeSpeed = 'relaxed'; // 'relaxed', 'normal', 'fast'
let skipGreeting = false;

// ── CEREMONY PHASE STATE (L-2246 prompt-state sync) ──────────────────────────
// Single source of truth for the active ceremony phase. All transitions call
// _setPhase(); renderGreeting() guards on _ceremonyPhase to prevent stale-tick
// desync (the bug: a trailing phraseInterval tick painting "Say the phrase" onto
// the digit-phase header after clearInterval fired).
const _PHASE = {
    IDLE:       'idle',
    COUNTDOWN:  'countdown',
    GREETING:   'greeting',
    DIGIT:      'digit',
    PROCESSING: 'processing',
    DONE:       'done',
    FAIL:       'fail',
};

// Phase → { title, color } for step2Title. One map = one place to audit for
// collisions that would make a desync invisible (P2 test: digit title ≠ greeting title).
const STATE_COACHING_MAP = {
    idle:       { title: '',                 color: '' },
    countdown:  { title: 'Get ready',        color: '' },
    greeting:   { title: 'Say the phrase',   color: '#fbbf24' },
    digit:      { title: 'Show the numbers', color: '' },
    processing: { title: 'One moment…', color: '' },
    done:       { title: 'Verified ✓',  color: '#22c55e' },
    fail:       { title: 'Try again',        color: '' },
};

let _ceremonyPhase = _PHASE.IDLE;

function _setPhase(phase) {
    _ceremonyPhase = phase;
    _renderPromptOnTransition(phase);
}

function _renderPromptOnTransition(phase) {
    var map = STATE_COACHING_MAP[phase];
    if (!map) return;
    try {
        var titleEl = document.getElementById('step2Title');
        if (titleEl) { titleEl.textContent = map.title; titleEl.style.color = map.color || ''; }
    } catch(_) {}
}

// F-654 STEP 2 — PHASE COMPOSITION IS A COPS/PID OUTPUT, not a local flag.
// The server's challenge response now carries reauth_modality_policy (F-654 step 1):
// the engine-DERIVED modality set for this re-auth. When that policy is present AND
// lists NO voice/voiceprint modality (low/medium-risk re-auth, e.g.
// required=[face_embedding,bound_digit,passive_liveness]), the spoken-phrase phase is
// STRUCTURALLY ABSENT — the ceremony goes straight to the fingers + per-gesture-digit
// phase (the digits are still spoken per gesture, so no voice signal is lost). This is
// the single source of truth for "does the phrase phase run"; mechanism is the policy,
// NOT a skipGreeting branch (skipGreeting only strips the WORDS — it KEEPS the phase).
//
// REGRESSION GUARD (non-negotiable, F-654 §7): DEFAULTS TO has-voice-phrase = TRUE.
// If reauth_modality_policy is absent/null/malformed (every full-auth call, and any
// call the backend made before step 1 deployed), this returns false → the phrase phase
// runs exactly as today → FULL AUTH IS BYTE-IDENTICAL. The skip can ONLY trigger for an
// explicit policy that affirmatively lists no voice modality.
function reauthPolicyDropsVoicePhrase() {
    try {
        var pol = challengeData && challengeData.reauth_modality_policy;
        if (!pol || !Array.isArray(pol.required) || !pol.required.length) return false; // no policy → keep phrase phase (full-auth default)
        var hasVoice = pol.required.some(function(m){ return /voice|voiceprint/i.test(String(m)); });
        return !hasVoice; // policy present AND no voice modality → drop the phrase phase
    } catch (_) {
        return false; // any error → safe default: keep the phrase phase
    }
}

// F-654: the policy's required modality set, or null if no policy on the current challenge.
// Single source for any path's modality-driven copy (full, seal, AND fast) — so no flow
// hardcodes its modalities. Returns e.g. ['face_embedding','bound_digit','passive_liveness'].
function reauthPolicyRequired() {
    try {
        var pol = challengeData && challengeData.reauth_modality_policy;
        if (pol && Array.isArray(pol.required) && pol.required.length) return pol.required.slice();
    } catch (_) {}
    return null;
}
// Does the policy require a finger/bound-digit modality? Drives the fast-path copy so it
// honestly states "face + one number on fingers" instead of "just a face photo".
function reauthPolicyHasBoundDigit() {
    var req = reauthPolicyRequired();
    if (!req) return null; // unknown — caller keeps its default copy
    return req.some(function(m){ return /bound_digit|finger|gesture/i.test(String(m)); });
}
// F-687 Fix 4: this module IS the re-auth ceremony. Every current caller re-confirms an already-
// enrolled identity EXCEPT auth.html's context:'register' (the first/main identity auth, which can
// be a first-time enrolment) — that one keeps the human-liveness heading. Default TRUE (re-auth):
// confirmed callers are vat-verify-reveal + tribunal-view-credential (re-auth) vs register (first
// auth). A future first-enrolment context would be exempted here too. Errors → true (Rob: default).
function _isReauthContext() {
    try { return CTX.context !== 'register'; } catch (_) { return true; }
}
const SPEED_CONFIG = {
    relaxed: { phrase: 5, digit: 2, countdown: 3 },
    normal:  { phrase: 3, digit: 1, countdown: 2 },
    fast:    { phrase: 2, digit: 0.8, countdown: 1 }
};

// ── Real-time finger detection (MediaPipe HandLandmarker) ────────────────────
// MOVED to the shared module /vac-finger-detect.js (single source of truth;
// also used by vat-verify.html quick re-auth and the finger-test bench). It is
// loaded as a plain <script> in <head> and defines window.FingerDetector with
// the identical API (init/detect/landmarks/ready/failed/reset/warmOnce) and the
// identical live-tested math (thumb angle<40 & spread>0.62; four-finger bend<35;
// warm-up grace + consecutive-slow-frame fallback). Server-side Gemini remains
// the trust gate — this is purely for UX responsiveness.

// Kick off HandLandmarker init as soon as the page loads so it's ready by
// the time the user reaches the recording step (takes ~1-2s to download model).
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(FingerDetector.init, 500); });
} else {
    setTimeout(FingerDetector.init, 500);
}
// Speed selector removed — real-time finger detection means user's own pace IS the pace.
// SPEED_CONFIG is retained for timer-fallback timing (when MediaPipe fails on a device).
// challengeSpeed is locked to 'relaxed' — the most forgiving fallback timing.
let retryAttempts = 0;
const MAX_RETRIES = 5;
let audioContext = null;
let audioAnalyser = null;
let _monitorStream = null;  // S157 C1: module-scope so startAudioMonitor() can stop prior clone on rewire
let audioAnimFrame = null;
// F-755d audio-bar/equaliser display-only onset instrumentation (task-515 P0-1,
// ported from vac-protocol b923dc3/a348465). Distinct from the real per-digit
// VAD gate's own threshold state (vadSpeechThreshold/_lastVadRms etc. below) —
// this only drives the ab0-4 bars + _renderEqualiser, never a pass/fail gate.
let audioNoiseFloor = 0.01; // seeded low; adapts up/down to the room via EMA
let audioOnsetActive = false;
const AUDIO_ONSET_DELTA = 0.025;    // rms must exceed floor by this much to trigger onset
const AUDIO_ONSET_RELEASE = 0.012;  // hysteresis: must drop back below floor+this to release
const AUDIO_FLOOR_EMA_ALPHA = 0.05;    // fast adaptation while quiet
const AUDIO_FLOOR_DRIFT_ALPHA = 0.002; // slow drift while onset-active (recovery only — see a348465: a hard freeze-while-active can never release in a sustained-loud room)
// S157 C1: continuous floor-relative VAD. Replaces INTERIM r2/r3 clamps with live re-derivation
// per digit window (frozen during onset/voiced runs). Wide sanity guards only — not narrow bounds.
const ADAPTIVE_SPEECH_DELTA = 0.028;    // speech threshold = floor + this (same headroom as r3, now continuous)
const ADAPTIVE_SILENCE_DELTA = 0.008;   // silence threshold = floor + this, always < speech
const ADAPTIVE_THR_MIN = 0.020;         // wide low guard (ultra-quiet anechoic rooms)
const ADAPTIVE_THR_MAX = 0.150;         // wide high guard (very loud environments)
var _adaptLastFloor = 0;                // floor value at last threshold derivation — tracks drift
var _adaptExplainTimer = null;          // F-1025: timer to hide the explain-as-you-adapt line
// S157 C1 rewire guard: module scope persists across startAudioMonitor() calls
var _audioRewireCount = 0;
var _audioLastRewireAt = 0;
var _audioRewireInFlight = false;



// ========== FAIL_REASONS ==========

// Fail reason descriptions + verdict.reasons -> display derivation now live in
// verdict-reasons.js (task-515 P0-2 port, shared with test_verdict_reasons.node.js)
// — showRetry() below calls window.VacVerdictReasons.deriveFailureDisplay(result)
// instead of deriving text from each modality's own `status` field.



// ========== camera + AV pre-flight + challenge + recording + detection + verify (verbatim) ==========

// STEP 1: Request camera + fetch challenge from backend
async function requestCamera() {
    const btn = document.getElementById('btnCamera');
    const err = document.getElementById('cameraError');
    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Requesting access…';
    const dev = showDeviceInfo();

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: true,
        });
        // F-720: self-diagnosing listeners — fires before onstop so we know which track died first.
        mediaStream.getTracks().forEach(function(t) {
            t.onended = function() { try { vacDebug('track_ended', null, { kind: t.kind, label: t.label }); } catch(_) {} };
        });
        const vid = document.getElementById('videoPreview');
        vid.srcObject = mediaStream;
        vid.muted = true;
        vid.setAttribute('playsinline', '');
        await vid.play().catch(() => {});
        // Warm the face-EMBEDDING models now so the enrollment descriptor is ready by
        // the time recording completes (face-api.js loads ~12MB on first use, cached after).
        try { if (window.VACFaceEmbed) window.VACFaceEmbed.ready(); } catch(_) {}
        // F-637c / codex P2: FAST still also needs MediaPipe ready — beginStillCapture reads a
        // single FingerDetector.detect() for the bound digit (detected_fingers). FULL warms it via
        // the hand pre-flight, but fast now skips that block, so warm it explicitly here (in
        // addition to the page-load auto-init at FingerDetector.init). Idempotent ("no-op if
        // already running"), so a cold/slow detector is loading through the whole pre-flight +
        // countdown instead of risking a null finger read at capture. Fast-only; FULL unchanged.
        try { if (modeConfig().capture.kind === 'still' && typeof FingerDetector !== 'undefined' && FingerDetector.init) FingerDetector.init(); } catch(_) {}
        document.getElementById('cameraLabel').textContent = 'CAMERA ACTIVE';

        // Show AV checks immediately — don't wait for challenge fetch
        document.getElementById('preRecordChecklist').style.display = 'block';
        document.getElementById('avAudioBar').style.display = 'block';
        startAVChecks();

        // Fetch challenge from backend (parallel — doesn't block AV checks)
        btn.textContent = 'Loading challenge…';
        btn.disabled = true;
        const d = userData();
        challengeData = null;  // clear stale challenge first so a FAILED fetch leaves it null and the blank-phrase guard fires (codex)
        // F-624 Rung 2: the active MODE picks the challenge endpoint + body shape (declarative,
        // see MODE_CONFIG). FULL (default) = POST /v1/vat/auth/challenge with the name/risk_level
        // body, carrying the optional num_digits profile actuator (COPS/PID; omitted → server
        // decides the count, prod behaviour intact). FAST = GET /v1/auth/face-reauth-challenge?email=
        // with no body. required_modalities + thresholds remain future profile fields.
        const _chCfg = modeConfig().challenge;
        const challengeBody = _chCfg.buildBody(d);   // object → JSON body; null → no body (GET)
        try {
            const _chOpts = { method: _chCfg.method };
            if (challengeBody != null) {
                _chOpts.headers = { 'Content-Type': 'application/json' };
                _chOpts.body = JSON.stringify(challengeBody);
            }
            const resp = await fetch(_chCfg.url(d), _chOpts);
            challengeData = await resp.json();
            // F-624 Rung 2 (codex P2): the FAST endpoint (/v1/auth/face-reauth-challenge) returns
            // {fingers:N} only — no phrase/digits. Normalize it into the {digits:[N]} shape the
            // SHARED intro renders, so the fast user SEES the finger target N (one circle in
            // showChallengeIntro) before beginStillCapture fires, instead of capturing blind.
            // Fast-only (capture kind 'still'); full mode is never touched here.
            if (modeConfig().capture.kind === 'still' && challengeData && typeof challengeData.fingers === 'number' && !(challengeData.digits && challengeData.digits.length)) {
                challengeData.digits = [challengeData.fingers];
            }
            // S111 diag: confirm whether the (re-)fetched challenge actually carries a
            // phrase. The re-auth blank-phrase bug renders "SAY THE PHRASE" with no value,
            // so this pins empty-fetch vs response-missing-phrase on the next live pass.
            try { vacDebug('challenge_fetched', null, { requested_num_digits: (challengeBody && challengeBody.num_digits != null ? challengeBody.num_digits : null), returned_digit_count: (challengeData && challengeData.digits) ? challengeData.digits.length : 0, has_phrase: !!(challengeData && challengeData.phrase), phrase_len: (challengeData && challengeData.phrase) ? String(challengeData.phrase).length : 0, has_digits: !!(challengeData && challengeData.digits && challengeData.digits.length), keys: challengeData ? Object.keys(challengeData).join(',') : null }); } catch(_) {}
        } catch (fetchErr) {
            console.error('[CHALLENGE FETCH]', fetchErr);
            try { vacDebug('challenge_fetch_failed', String(fetchErr && fetchErr.message || fetchErr)); } catch(_) {}
            // Show error but keep AV checks running
            err.innerHTML = `<div style="color: var(--warning); margin-bottom: 4px;">Could not load challenge — check your connection and try again.</div>`;
            err.style.display = 'block';
        }

        btn.textContent = 'Complete the checks above';
        btn.disabled = true;            // S110: start gated; updateAVReady enables once light+mic+hand all pass
        btn.onclick = goToChallenge;
        updateAVReady();                // reflect current check state immediately
        // Fetch adaptive modality requirements
        fetchModalityRequirements();
    } catch (e) {
        // Browser-specific troubleshooting tips
        const tips = getCameraTips(dev);
        let errHtml = `<div style="margin-bottom: 6px;">${e.message || 'Camera access denied.'}</div>`;
        if (tips.length > 0) {
            errHtml += `<div style="font-size: 11px; color: var(--text-tertiary); line-height: 1.5;">`;
            tips.forEach(t => { errHtml += `<div style="margin-top: 3px;">→ ${t}</div>`; });
            errHtml += `</div>`;
        }
        err.innerHTML = errHtml;
        err.style.display = 'block';
        btn.textContent = 'Retry Camera Access';
        btn.disabled = false;
    }
}

// --- Device & Browser Detection (from folioAI) ---
function detectDevice() {
    const ua = navigator.userAgent;
    let os = 'Unknown';
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Linux/.test(ua)) os = 'Linux';

    let browser = 'Unknown', ver = '';
    if (/CriOS\/(\d+)/.test(ua)) { browser = 'Chrome (iOS)'; ver = ua.match(/CriOS\/(\d+)/)?.[1] || ''; }
    else if (/FxiOS\/(\d+)/.test(ua)) { browser = 'Firefox (iOS)'; ver = ua.match(/FxiOS\/(\d+)/)?.[1] || ''; }
    else if (/Edg\/(\d+)/.test(ua)) { browser = 'Edge'; ver = ua.match(/Edg\/(\d+)/)?.[1] || ''; }
    else if (/Chrome\/(\d+)/.test(ua) && /Google/.test(navigator.vendor)) { browser = 'Chrome'; ver = ua.match(/Chrome\/(\d+)/)?.[1] || ''; }
    else if (/Firefox\/(\d+)/.test(ua)) { browser = 'Firefox'; ver = ua.match(/Firefox\/(\d+)/)?.[1] || ''; }
    else if (/Version\/(\d+)/.test(ua) && /Safari/.test(ua)) { browser = 'Safari'; ver = ua.match(/Version\/(\d+)/)?.[1] || ''; }

    let device = 'desktop';
    if (/iPhone|Android.*Mobile/.test(ua)) device = 'mobile';
    else if (/iPad|Android/.test(ua) && !/Mobile/.test(ua)) device = 'tablet';

    return { device, browser, ver, os };
}

function getCameraTips(dev) {
    const tips = [];
    if (dev.browser === 'Safari') {
        if (dev.os === 'iOS') tips.push('On iPhone: Settings → Safari → Camera & Microphone → Allow');
        else tips.push('Safari → Settings → Websites → Camera/Microphone → Allow');
    } else if (dev.browser.includes('Chrome')) {
        tips.push('Chrome: Menu (⋮) → Settings → Privacy → Site settings → Camera/Microphone → Allow');
        if (dev.os === 'iOS') tips.push('iPhone: Settings → Chrome → Camera & Microphone → turn on');
        else if (dev.os === 'macOS') tips.push('Mac: System Settings → Privacy & Security → Camera/Microphone → tick Chrome');
    } else if (dev.browser === 'Firefox') {
        tips.push('Firefox: Menu (☰) → Settings → Privacy → Permissions → Camera/Microphone → Allow');
    } else if (dev.browser === 'Edge') {
        tips.push('Edge: Menu (⋯) → Settings → Cookies & permissions → Camera/Microphone → Allow');
    }
    tips.push('Close other apps using your camera (Zoom, Teams, FaceTime)');
    return tips;
}

// Show device info on camera step
function showDeviceInfo() {
    const dev = detectDevice();
    const el = document.getElementById('deviceInfo');
    if (el) el.textContent = `${dev.browser}${dev.ver ? ' ' + dev.ver : ''} · ${dev.os} · ${dev.device}`;
    return dev;
}

// --- Automated AV Checks (adapted from folioAI) ---
let avCheckFrame = null;
let avAudioCtx = null;
let avAnalyser = null;
let avChecks = { light: false, mic: false, hand: false };
let _avSilentFrames = 0; // S154 fix-on-find: consecutive near-zero-input pre-flight frames while mic hasn't qualified — after ~6s, warns of a likely wrong-mic selection
let avPrevOval = null; // previous frame luminance for motion detection
let _handStableFrames = 0; // F-755d: consecutive frames where hand passes _near+21-finite gate
let _handUnstableFrames = 0; // T-329a: consecutive frames the LATCHED hand-ready state loses zone acceptance
const AV_HAND_GRACE_MS = 3000; // F-929 (Rob, S147): bounded, VISIBLE grace after hand-drop so one-handed users can reach Start — honesty preserved by the on-chip countdown
let _handGraceStartT = 0;      // F-929: timestamp when the current grace window opened (0 = not in grace)
let _micLoudFrames = 0;   // F-755f: consecutive audio frames above the sustained-level threshold
let _micLevelHistory = []; // T-329c: {t, level} ring buffer (last 2s) for the ambient-median comparison
let _micRunLevels = [];    // T-329c: levels making up the CURRENT sustained >12% run
let _micRunRatios = [];    // F-941: voice-band ratios paired frame-for-frame with _micRunLevels
let _micRunStartT = 0;     // T-329c: performance.now() when the current run began
let _micLastQualifyT = 0;  // T-329c: last time a qualifying (ambient-relative) run occurred — drives 10s regression
let _micSeedLevels = [];   // GATE-343 f2: levels captured in the first 1.5s after mic-open, before any prompt
let _micSeedStartT = 0;    // GATE-343 f2: performance.now() when seed collection began
let _micSeededAmbient = 0; // GATE-343 f2: seeded ambient median — real floor when live pre-run history is thin/empty
let _micSeeded = false;    // GATE-343 f2: true once the 1.5s seed window has closed
// D-VAD-CALIBRATION-GREETING-BOUND: the preflight's own qualifying run (the "Mic: working" check
// below) already measures this session's real speaking level over this room's ambient — the
// median level of the run that passed _micQualifyFloor. Persisted (module scope) alongside
// _micSeededAmbient so the ceremony VAD can arm from BOTH instead of starting deaf on fallback
// constants until a greeting it can't hear over the noise recalibrates it.
let _micSeededSpeechLevel = 0;
// D-VAD-UNITS (task-447, live evidence: Rob's 17:24 UTC run — thr 0.128 unreachable, greeting
// spoken and never detected): _micSeededAmbient/_micSeededSpeechLevel above are TIME-domain peak %
// (0-100, see `level` in runAVFrame) — a different quantity, on a different scale, from what the
// ceremony VAD actually compares (time-domain RMS √mean((v-128)²)/128, 0-1, see _ceremonyRms below and
// its verbatim twins at the digit gate ~_startSpeechGate and the phrase gate ~_phraseVadTick). The
// task-443 fix handed the ceremony derivation `level`/100, which reads nothing like ceremony-scale
// RMS — right idea, wrong units, unreachable threshold. These are the ceremony-RMS-scale twins,
// sampled from the SAME frames/windows as the pair above, so the derivation below can arm from THIS
// room's ambient and THIS user's speech in the ceremony VAD's OWN units — no cross-scale conversion.
let _micSeededAmbientRms = 0;
let _micSeededSpeechRms = 0;
let _micSeedRmsSamples = [];  // ceremony-scale twin of _micSeedLevels, same 1.5s seed window
let _micRunRmsSamples = [];   // ceremony-scale twin of _micRunLevels, same qualifying run
let _micPreflightVadReason = null;  // last _micPreflightVad() null-return reason — surfaced in vad_calibrated for field diagnosis
// F-941 (BUILD 393, restaurant failure): a loud room's ambient floor is broadband/impulsive
// (plates, chatter, HVAC) while speech concentrates in ~187Hz-3kHz. A run whose energy sits
// mostly in that voice band shouldn't have to out-shout the room the way flat noise would —
// see the reduced ambient multiplier at the qualify check below.
const VOICE_BAND_MIN_RATIO = 0.45; // S148 field-tune: Rob speaking on a London street read 52% — 0.55 missed real speech; street rumble dilutes the ratio.
// S429: single source for the mic qualify floor — used by the pre-flight collector gate (what
// counts as part of a "loud enough" run), the sustained-run qualify check, and the live meter's
// gold line, so a given room reads the same threshold everywhere instead of drifting between an
// unreachable flat collector gate and a lower qualify floor it was supposed to feed (field
// measurement: Rob's speech read 46% in a quiet room but 9% outdoors — a fixed number can't gate
// both a 1% room and a 40% street). Pre-seed (_micSeededAmbient still 0) this collapses to the
// flat floor (8 voiced / 12 non-voiced), matching today's startup behaviour until ambient is known.
function _micQualifyFloor(_voiced) {
    const _mult = _voiced ? 1.15 : 2;   // F-941: voice-band-dominant energy needs less headroom over ambient than flat/broadband noise
    const _floor = _voiced ? 8 : 12;    // S148 field-tune: the flat 12 floor was unreachable for Rob's 9% outdoor speech; voice-shaped runs may qualify from 8
    return Math.max(_mult * _micSeededAmbient, _floor);
}

// D-VAD-CALIBRATION-GREETING-BOUND fix: the ceremony VAD (vadSpeechThreshold/vadSilenceThreshold
// in beginRecording, FAST_VAD_SPEECH_RMS/FAST_VAD_SILENCE_RMS in the quick-reauth tier) used to
// calibrate ONLY from the greeting/bound digit it hears AFTER arming on flat fallback constants —
// circular in a noisy room, where those constants can't hear the greeting to calibrate off it in
// the first place (Rob's live noisy run: waited_s=17, voice_ms=0 the whole digit phase). The
// preflight already measures this room's ambient (_micSeededAmbient) AND this user's qualifying
// speaking level (_micSeededSpeechLevel) to answer its own "Mic: working" pass/fail — reuse those
// two numbers to arm the ceremony VAD relative to THIS room instead of an absolute guess. Same
// floor→speech relative formula the greeting calibration already uses (K = fraction of the way
// from floor to speech), so this isn't a new absolute level (L-2403) — just an earlier source for
// the same derivation. Returns null (caller keeps its fallback constants) when the preflight never
// measured both quantities, or the span between them is too thin to trust.
// BEGIN CALIBRATION BLOCK (task-645) — provenance anchor for confirmed-behaviors fixture CB-MIC-01.
// SHA256 of this block body (between markers, trimmed) is stored in tests/fixtures/confirmed/founding-rows.json.
// Any change here must update the fixture sha256 field and add a new fixture row (see docs/CONFIRMED-BEHAVIORS.md).
const _CAL_K = 0.32;         // mirrors the greeting calibration's _CAL_K — speech threshold sits 32% of the way from floor to speech
const _CAL_SIL_K = 0.30;     // mirrors the greeting calibration's _CAL_SIL_K — silence threshold sits 30% of the way from floor to the speech threshold (floor < silence < speech, provably, regardless of clamping)
const _CAL_MIN_SPAN = 0.04;  // mirrors the greeting calibration's _CAL_MIN_SPAN — reject a degenerate (near-zero) floor→speech span rather than calibrate off noise
function _calClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// S155 PER-SPEAKER FAST CALIBRATION — SHARED helper (D-VAD-GATE-FORK companion: ONE formula, ONE
// call site definition, called from BOTH the full and fast tiers below — advances the fork-guard's
// eventual goal without a full unification of the two calibration subsystems, per the packet).
// _micPreflightVad() above needs BOTH a measured ambient floor AND a measured speech sample from
// the pre-flight AV check; whenever the user didn't speak enough there (or the AV check never
// qualified), both tiers previously fell straight through to a FLAT hardcoded constant
// (VAD_SPEECH_RMS_FALLBACK / FAST_VAD_SPEECH_RMS = 0.085, time-domain) — identical for every speaker and every
// room. This is a simpler, floor-ONLY formula (needs no speech sample at all) that still
// personalises the threshold to THIS room/mic: rollingFloor is audioNoiseFloor, the continuously
// EMA-adapting ambient estimate (startAudioMonitor, AUDIO_FLOOR_EMA_ALPHA/AUDIO_FLOOR_DRIFT_ALPHA
// above) — a live, rolling read, not a one-shot seed sample — so it's available at ARM time even
// on a first-ever fast-tier attempt with no prior greeting. clamp(rollingFloor*1.8, 0.05, 0.13):
// verified against the Skyssia fixture (auth-debug 4 Aug ~10:25 UTC, session
// sess_osdy8boy_reauth): floor 0.044-0.054 -> thr 0.079-0.097, comfortably under her observed
// voice peaks 0.058-0.124 (the flat-0.13-ceiling fallback was at risk of clipping her quieter
// utterances), while a ~0.07 no-voice ambient reading still sits below every realistic
// floor*1.8 result and correctly does not cross it. Sits BETWEEN the full preflight calibration
// (preferred, when available) and the flat constant (last-resort, when even the floor is
// unmeasured) — never overrides a real calibration, only upgrades the fallback.
const FAST_CAL_FLOOR_MULT = 1.8;
const FAST_CAL_THR_MIN = 0.05;
const FAST_CAL_THR_MAX = 0.13;
function _fastCalThreshold(rollingFloor) {
    if (!(rollingFloor > 0)) return null;   // no live floor read yet — caller keeps its flat fallback
    return _calClamp(rollingFloor * FAST_CAL_FLOOR_MULT, FAST_CAL_THR_MIN, FAST_CAL_THR_MAX);
}

function _micPreflightVad() {
    _micPreflightVadReason = null;
    // D-VAD-UNITS (task-447): arm from the ceremony-RMS-scale samples (_micSeededAmbientRms /
    // _micSeededSpeechRms) — the SAME quantity, SAME units, the ceremony VAD ticks compare against
    // every frame. No /100 conversion here: that was the bug (a 0-100 time-domain peak % hint fed
    // straight into a 0-1 frequency-domain rms comparison sets an unreachable threshold — thr 0.128
    // against real ceremony-RMS speech of ~0.03-0.1 outdoors never fires).
    if (!(_micSeededAmbientRms > 0)) { _micPreflightVadReason = 'no_ambient_sample'; return null; }
    if (!(_micSeededSpeechRms > 0)) { _micPreflightVadReason = 'no_speech_sample'; return null; }  // user barely spoke during preflight — caller keeps its fallback constants
    const _floor01 = _micSeededAmbientRms, _speech01 = _micSeededSpeechRms;
    const _span = _speech01 - _floor01;
    if (_span < _CAL_MIN_SPAN) { _micPreflightVadReason = 'thin_span'; return null; }  // degenerate — caller keeps its fallback constants
    const speechThr = _calClamp(_floor01 + _CAL_K * _span, 0.06, Math.max(0.13, _floor01 + 0.03));   // S154 data-driven ceiling: telemetry shows thr .166 eating normal speech (peaks .17-.21) while .093-.119 runs were flawless — cap at .13 unless the ambient floor itself is high (ordering floor<thr preserved via floor+.03)
    const silenceThr = _floor01 + _CAL_SIL_K * (speechThr - _floor01);
    return { speechThr: speechThr, silenceThr: silenceThr, floor: _floor01, speech: _speech01 };
}
// END CALIBRATION BLOCK (task-645)

// Client-side PROXY for the server's hand_near_face anti-spoof gate, used ONLY to give the
// user live feedback (the server still recomputes hand_near_face — this never gates auth and
// does NOT relax the constraint, and is NOT in any advance gate). Shared by BOTH the pre-flight
// hand test (runAVFrame) and the real gesture step (runDetectionLoop) so the user practises the
// SAME constraint they'll be held to — one source of truth, no drift.
// F-755d: _HAND_ZONE_RX/_HAND_ZONE_RY/_ptInHandZone removed (pre-S139 centre-oval dead code).
// Acceptance gate is now GESTURE_ZONE_SPEC (two cheek ovals) via _handNearFaceZone below.
// Drawn guide is canvas-drawn from GESTURE_ZONE_SPEC in _avDrawHand/_drawFingerTargetGuide.
// L-2299: single source of truth for gesture zone geometry.
// Detector acceptance gate, coaching trigger, and canvas overlay ALL read from this spec.
// rx/ry: acceptance radii = drawn oval radii so the ring IS the gate (no mismatch).
// Widened from prior 0.15/0.19 so a natural spread-finger beside-cheek pose at normal
// phone/laptop distance is inside (old 0.15/0.19 only passed when the hand was far back
// and landmarks were compressed — the inversion bug described in D-GESTURE-ZONE-2026-07-18).
//
// task-432 (Rob framing): this on-screen zone is NOT a security gate — it exists only to
// coach the hand into roughly where the GEMINI SERVER-SIDE vision check can see it. These
// constants are now the FALLBACK geometry (frame-anchored), used whenever no confident face
// read is available — never a dead zone. When a face read IS confident, _activeZone() below
// anchors the ovals beside the DETECTED face instead, so distance-to-camera stops mattering.
const GESTURE_ZONE_SPEC = Object.freeze({
    ovals: [
        { cx: 0.18, cy: 0.48, side: 'left'  },
        { cx: 0.82, cy: 0.48, side: 'right' },
    ],
    rx: 0.21,          // task-644: 0.17→0.21 (relax toward beside-cheek natural pose; Gemini is the real judge)
    ry: 0.26,          // task-644: 0.22→0.26
    minTipsInside: 2,  // task-644: 3→2 (palm-centre OR 2 fingertips — err on accepting)
});

// task-432 Part 6 (Rob directive, "Def use MediaPipe"): FACE-BOUNDS come from a REAL detector —
// MediaPipe FaceLandmarker (478 3-D landmarks; a bounding box derives from landmark min/max x,y).
// This replaces the earlier luma/skin-pixel scan entirely: even the improved YCbCr chrominance
// check distributed the UX benefit unevenly across skin tones/lighting, and a real detector
// removes the question. Confidence is now the detector's own (no face landmarks → no read), so
// _activeZone() still falls back to the fixed GESTURE_ZONE_SPEC constants whenever there's no
// confident read — never a dead zone.
const _FACE_ASPECT = 0.78;    // typical face width/height ratio, for deriving width from height
const _FACE_SIDE_GAP = 0.10;  // task-644: 0.03→0.10 so anchored ovals sit BESIDE the face not on it
let _faceAnchor = { anchored: false, cx: 0.5, cy: GESTURE_ZONE_SPEC.ovals[0].cy, hFrac: null };
let _faceAnchorMissStreak = 0;
const _FACE_ANCHOR_EMA = 0.35;       // blend weight per confident read — smooths single-frame jitter
const _FACE_ANCHOR_DROP_STREAK = 2;  // consecutive misses before dropping back to the fallback constants

// Warm-init MediaPipe FaceLandmarker — same CDN bundle vac-finger-detect.js already loads for
// HandLandmarker (@mediapipe/tasks-vision), so the browser's module cache serves this import for
// free once either detector has loaded it. Kept self-contained to this file: this lane's scope is
// vac-reauth-ceremony.js only, so this does NOT touch window.__VAC_MediaPipe (defined inline in
// each host HTML page) — it does its own dynamic import + FilesetResolver, mirroring the warm-init
// KICK-OFF pattern above (FingerDetector.init) without depending on that other module wiring.
// Sampled only at the existing ~4fps anchor-update cadence (_maybeUpdateFaceAnchor) — never at
// full frame rate purely for ovals.
const _FACE_LANDMARKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// F-788-style stall guard (codex-adversarial finding, task-432 Part 6): vac-finger-detect.js's
// HandLandmarker init proved live (S134 telemetry) that createFromOptions can hang indefinitely on
// a stalled model download with no exception — a fixed total-time timeout would also kill
// slow-but-working downloads on real (Gatwick Express, hotel wifi) connections, so this fails on a
// STALL (no bytes for _STALL_MS), never total duration, mirroring that fix.
async function _fetchFaceModelBlob(url) {
    const STALL_MS = 12000;
    const resp = await Promise.race([
        fetch(url, { cache: 'force-cache' }),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error('connect_stall')); }, STALL_MS); }),
    ]);
    if (!resp.ok) throw new Error('http_' + resp.status);
    if (!resp.body || !resp.body.getReader) return URL.createObjectURL(await resp.blob());
    const reader = resp.body.getReader();
    const chunks = [];
    while (true) {
        const r = await Promise.race([
            reader.read(),
            new Promise(function(_, rej) { setTimeout(function() { rej(new Error('stall')); }, STALL_MS); }),
        ]);
        if (r.done) break;
        chunks.push(r.value);
    }
    return URL.createObjectURL(new Blob(chunks));
}
const _FaceAnchorDetector = (function() {
    let detector = null, isReady = false, hasFailed = false, loading = null;
    async function init() {
        if (isReady || hasFailed) return isReady;
        if (loading) return loading;
        loading = (async function() {
            let blobUrl = null;
            try {
                const mod = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
                const vision = await mod.FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
                );
                blobUrl = await _fetchFaceModelBlob(_FACE_LANDMARKER_MODEL_URL);
                detector = await mod.FaceLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: blobUrl, delegate: "GPU" },
                    runningMode: "VIDEO",
                    numFaces: 1,
                    outputFaceBlendshapes: false,
                    outputFacialTransformationMatrixes: false,
                });
                isReady = true;
                console.log('[VAC] FaceLandmarker ready — face-anchored gesture zone active');
                return true;
            } catch (e) {
                hasFailed = true;
                console.warn('[VAC] FaceLandmarker unavailable, gesture zone will use fallback geometry:', (e && e.message) || e);
                return false;
            } finally {
                if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch(_) {}
            }
        })();
        return loading;
    }
    // Bounding box from landmark min/max x,y, normalized to the SAME {cx,cy,hFrac} shape the old
    // pixel scan returned, so _updateFaceAnchor's EMA + miss-streak logic below is unchanged.
    function detect(videoEl) {
        if (!isReady || !detector) return null;
        let res;
        try { res = detector.detectForVideo(videoEl, performance.now()); }
        catch (e) { hasFailed = true; detector = null; return null; } // detector faulted — fall back, never throw into the caller
        const lm = res && res.faceLandmarks && res.faceLandmarks[0];
        if (!lm || !lm.length) return null;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < lm.length; i++) {
            const p = lm[i];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        // codex-adversarial finding (task-432 Part 6): a corrupted/all-NaN frame (e.g. a transient
        // GPU delegate hiccup) must never anchor to a degenerate box — reject it exactly like "no
        // face", so _updateFaceAnchor's miss-streak counts it as a miss, not a confident read.
        if (!(maxX > minX) || !(maxY > minY)) return null;
        return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, hFrac: maxY - minY };
    }
    return { init: init, detect: detect, get ready() { return isReady; }, get failed() { return hasFailed; } };
})();
// Kick off FaceLandmarker init as soon as the page loads (same warm-init trigger as
// FingerDetector.init above) so it's ready by the time the user reaches the pre-flight checks.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_FaceAnchorDetector.init, 500); });
} else {
    setTimeout(_FaceAnchorDetector.init, 500);
}

// Updates the module-level face anchor from the real detector. Never throws — any failure just
// clears back to "not anchored" (fallback constants), per the "never a dead zone" requirement.
function _updateFaceAnchor(videoEl) {
    if (!videoEl || !videoEl.videoWidth) { _faceAnchor = { anchored: false, cx: 0.5, cy: GESTURE_ZONE_SPEC.ovals[0].cy, hFrac: null }; _faceAnchorMissStreak = 0; return; }
    let r = null;
    try { r = _FaceAnchorDetector.detect(videoEl); } catch(_) { r = null; }
    if (r) {
        _faceAnchorMissStreak = 0;
        // EMA-smooth against the previous confident read so a single noisy frame (auto-exposure
        // hunting, a blink, a slight head turn) doesn't visibly snap the coaching oval — the user
        // is meant to read this as a stable "hold it here" target, not a jittery live tracker.
        _faceAnchor = (_faceAnchor.anchored && _faceAnchor.hFrac != null)
            ? { anchored: true, cx: _faceAnchor.cx + _FACE_ANCHOR_EMA * (r.cx - _faceAnchor.cx), cy: _faceAnchor.cy + _FACE_ANCHOR_EMA * (r.cy - _faceAnchor.cy), hFrac: _faceAnchor.hFrac + _FACE_ANCHOR_EMA * (r.hFrac - _faceAnchor.hFrac) }
            : { anchored: true, cx: r.cx, cy: r.cy, hFrac: r.hFrac };
    } else {
        // Absorb a single bad frame — only drop back to the fallback constants after a SUSTAINED
        // miss streak, so the zone doesn't flicker fallback/anchored on every noisy read.
        _faceAnchorMissStreak++;
        if (_faceAnchorMissStreak >= _FACE_ANCHOR_DROP_STREAK) {
            _faceAnchor = { anchored: false, cx: 0.5, cy: GESTURE_ZONE_SPEC.ovals[0].cy, hFrac: null };
        }
    }
}
let _faceAnchorLastSampleT = 0;
function _maybeUpdateFaceAnchor(videoEl) {
    const t = performance.now();
    if (t - _faceAnchorLastSampleT < 250) return;   // ~4fps — matches the existing light-check cadence
    _faceAnchorLastSampleT = t;
    _updateFaceAnchor(videoEl);
}

// Single source of truth for the ACTIVE zone geometry — face-anchored beside the estimated
// cheeks when confident, else GESTURE_ZONE_SPEC's fixed fallback (never a dead zone). BOTH
// _ptInCheekZone (acceptance) and _ptInTickZone (wider pre-flight tick) read this, and the
// drawn guide (_drawFingerTargetGuide / _avDrawHand) draws from it too, so all three always
// agree — no drift between what's drawn and what's accepted.
function _activeZone() {
    if (!_faceAnchor.anchored || _faceAnchor.hFrac == null) {
        return { ovals: GESTURE_ZONE_SPEC.ovals, rx: GESTURE_ZONE_SPEC.rx, ry: GESTURE_ZONE_SPEC.ry, anchored: false, faceW: null };
    }
    const hFrac = _faceAnchor.hFrac;
    const wFrac = hFrac * _FACE_ASPECT;
    // task-zone-harness-then-fix (L-2446, revert d8a1374): face-proportional radii so oval width
    // stays ~44% of face width at any seating distance. The old hFrac*0.42 formula produced ovals
    // wider than the face at close range (A2 fail) and the 94ba1b9 wFrac*0.40 attempt pushed oval
    // centers to the screen edge (cxLeft=rx) so the inner half was invisible — "vanish" (A1/A3 fail).
    // New: rx = 22% face width, ry = 30% face height, gap = 15% face width (all face-proportional).
    const rx = Math.min(0.15, 0.22 * wFrac);
    const ry = Math.min(0.20, 0.30 * hFrac);
    // Gap is face-proportional so it stays in the [0.10, 0.50] faceW assertion band at all distances.
    const gap = Math.max(_FACE_SIDE_GAP, 0.15 * wFrac);
    const halfW = wFrac / 2;
    const faceCx = _faceAnchor.cx;
    let cxLeft  = faceCx - halfW - gap - rx;
    let cxRight = faceCx + halfW + gap + rx;
    // Clamp so the ENTIRE oval stays in-frame (centre ± radius stays in [0,1]) with a 0.5% margin.
    cxLeft  = Math.max(rx + 0.005, Math.min(0.5 - rx, cxLeft));
    cxRight = Math.min(1.0 - rx - 0.005, Math.max(0.5 + rx, cxRight));
    return {
        ovals: [ { cx: cxLeft, cy: _faceAnchor.cy, side: 'left' }, { cx: cxRight, cy: _faceAnchor.cy, side: 'right' } ],
        rx, ry, anchored: true, faceW: wFrac,
    };
}

// Interactive QA hook — exposes _activeZone() for manual live debugging via ?qa=1.
// The automated test (zone-geometry.test.js) extracts the formula directly from source
// and does not use this hook. Never active in production without deliberate ?qa=1 activation.
if (_qaFlag) {
    window.__zoneDebug = {
        setFaceAnchor: function(a) { _faceAnchor = { anchored: true, cx: a.cx, cy: a.cy, hFrac: a.hFrac }; },
        clearFaceAnchor: function() { _faceAnchor = { anchored: false, cx: 0.5, cy: GESTURE_ZONE_SPEC.ovals[0].cy, hFrac: null }; },
        getActiveZone: function() { return _activeZone(); },
    };
}

function _ptInCheekZone(p) {
    const z = _activeZone();
    for (const o of z.ovals) {
        const dx = (p.x - o.cx) / z.rx, dy = (p.y - o.cy) / z.ry;
        if (dx * dx + dy * dy <= 1) return true;
    }
    return false;
}
// task-432 Part 2 (Rob framing: err on accepting — Gemini is the real judge): dropped the
// wrist-inside requirement, which forced the hand back further than a natural beside-the-cheek
// pose. New test: palm-centre (average of the four MCP knuckles, a stabler point than any single
// knuckle) inside the oval, OR a majority (3 of 5) of fingertips inside.
function _handNearFaceZone(lm) {
    if (!lm || lm.length < 21) return false;
    const palm = { x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4, y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4 };
    if (_ptInCheekZone(palm)) return true;
    const tips = [4, 8, 12, 16, 20];                // thumb..pinky fingertips
    let inside = 0;
    for (const t of tips) { if (_ptInCheekZone(lm[t])) inside++; }
    return inside >= GESTURE_ZONE_SPEC.minTipsInside;
}
// codex review (task-432 round 5): _handNearFaceZone's result is uploaded as part of
// client_pose_zones (see F-GESTURE-ZONE-QUALIFIES-POSE below), which the BACKEND uses to DROP a
// pose from the reconstructed sequence when false — that makes it a real (if defense-in-depth)
// server-side signal, not pure UI coaching. The face-anchor estimate is a best-effort heuristic
// that can misfire (stale EMA, an edge-clamped read); if it shifted the zone in a way that turned
// a genuinely good pose false, the backend would drop a legitimate re-auth pose — the exact
// false-friction this lane is supposed to eliminate, not add. So the backend-facing signal stays
// on the DETERMINISTIC fallback geometry only (still gets Part 2's relaxed membership test, which
// only ever makes MORE poses register true — pure generosity, no new drop risk); the on-screen
// coaching zone (_handNearFaceZone above) is the one that gets the face-anchored experience.
function _handNearFallbackZone(lm) {
    if (!lm || lm.length < 21) return false;
    const rx = GESTURE_ZONE_SPEC.rx, ry = GESTURE_ZONE_SPEC.ry;
    const inFallbackOval = (p) => GESTURE_ZONE_SPEC.ovals.some((o) => {
        const dx = (p.x - o.cx) / rx, dy = (p.y - o.cy) / ry;
        return dx * dx + dy * dy <= 1;
    });
    const palm = { x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4, y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4 };
    if (inFallbackOval(palm)) return true;
    const tips = [4, 8, 12, 16, 20];
    let inside = 0;
    for (const t of tips) { if (inFallbackOval(lm[t])) inside++; }
    return inside >= GESTURE_ZONE_SPEC.minTipsInside;
}
// F-755h: wider tick-zone for Hand✓ pre-flight tick — separate from acceptance gate, but now
// face-anchored off the SAME _activeZone() ovals (scaled wider) so it moves with the acceptance
// gate instead of drifting from it.
const _TICK_ZONE_RX = 0.28, _TICK_ZONE_RY = 0.30;
function _ptInTickZone(p) {
    const z = _activeZone();
    const scale = z.anchored ? (z.rx / GESTURE_ZONE_SPEC.rx) : 1;
    const rx = _TICK_ZONE_RX * scale, ry = _TICK_ZONE_RY * scale;
    for (const o of z.ovals) {
        const dx = (p.x - o.cx) / rx, dy = (p.y - o.cy) / ry;
        if (dx * dx + dy * dy <= 1) return true;
    }
    return false;
}
function _handInTickZone(lm) {
    if (!lm || lm.length < 21) return false;
    const palm = { x: (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4, y: (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4 };
    if (_ptInTickZone(palm)) return true;
    const tips = [4, 8, 12, 16, 20];
    let inside = 0;
    for (const t of tips) { if (_ptInTickZone(lm[t])) inside++; }
    return inside >= 3;
}
// task-432 Part 4: throttled transition telemetry — server-readable via /v1/auth/debug so the
// give can be tuned from real runs. Only fires on an ACTUAL in/out transition (no per-frame spam).
function _noteHandZoneTransition(prevState, isIn, zone) {
    if (prevState === null) return isIn;   // seed silently — not a real transition, just the first classified frame
    if (prevState === isIn) return prevState;
    try {
        vacDebug('hand_zone', isIn ? 'in' : 'out', {
            anchored: zone.anchored ? 'face' : 'fallback',
            face_w: zone.faceW != null ? Number(zone.faceW.toFixed(3)) : null,
        });
    } catch(_) {}
    return isIn;
}

function startAVChecks() {
    // F-563 (3): RESET every pre-flight pill to the un-ticked "checking" state on EVERY entry.
    // On re-auth the Light/Mic/Hand pills kept the prior session's ✓ (same stale-state-on-re-entry
    // family as resetModalities/overlay), so the user saw green ticks while "Start" stayed disabled
    // and didn't realise they had to act. setAVStatus('checking',…) strips good/warn/bad + restores
    // the spinner, so the checks visibly re-run and the path to Start is obvious. Reset the GATE
    // STATE too (not just the pills) — else an entry reaching startAVChecks without resetBiometricUI
    // (e.g. the blank-challenge retry re-calling requestCamera) would leave avChecks latched true and
    // updateAVReady could enable Start / auto-proceed without the pre-flight actually re-running
    // (codex). runAVFrame re-sets each true within a frame or two if conditions hold, so this only
    // forces a genuine re-check.
    avChecks = { face: false, light: false, mic: false, hand: false };
    _handStableFrames = 0;
    _handUnstableFrames = 0;
    _micLoudFrames = 0;
    _micLevelHistory = [];
    _micRunLevels = [];
    _micRunRatios = [];
    _micRunStartT = 0;
    _micLastQualifyT = 0;
    _micSeedLevels = [];
    _micSeedStartT = 0;
    _micSeededAmbient = 0;
    _micSeededSpeechLevel = 0;
    _micSeededAmbientRms = 0;
    _micSeededSpeechRms = 0;
    _micSeedRmsSamples = [];
    _micRunRmsSamples = [];
    _micSeeded = false;
    _avSilentFrames = 0; // S154: fresh entry/retry gets a fresh 6s wrong-mic detection window
    micWaitStart = 0; // F-755f: reset mic-wait timer so retry doesn't immediately show "Mic not picking up audio?"
    setAVStatus('light', 'checking', 'Light');
    setAVStatus('mic', 'checking', 'Mic');
    setAVStatus('hand', 'checking', 'Hand');
    // Initialize pill icons with spinners
    ['avLightIcon', 'avMicIcon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = AV_ICONS.spinner; el.classList.add('spinning'); }
    });
    // FAST still (S120 unify / F-637c): the PRE-FLIGHT camera box (#cameraBox) is a quiet single
    // #faceOval face-check — no hand-zone apparatus, no hand pre-flight gate (that stranded the fast
    // user). NOTE (F-626): this is the PRE-FLIGHT only; the CAPTURE step (#cameraBoxRec, set in
    // goToChallenge's fast direct path) DOES reuse the wide .hand-zone oval so the face and fingers
    // frame together. So for capture.kind==='still' hide the Hand pill + hand hint and strip any
    // stale show-hand-zone/hand-in-zone chrome off #cameraBox on EVERY entry (covers the
    // retryAVSetup re-entry, not just the initial DOM). Deterministic display ('' restores
    // the pill for FULL) so re-running in either mode lands the right state. The hand
    // pre-flight block (runAVFrame) + the Start-gate (updateAVReady) are gated on the SAME
    // _fastStill below; FULL/clip is byte-unchanged (regression-guarded default).
    const _fastStill = (modeConfig().capture.kind === 'still');
    try {
        const _ph = document.getElementById('avPillHand'); if (_ph) _ph.style.display = _fastStill ? 'none' : '';
        if (_fastStill) {
            const _hh = document.getElementById('avHandHint'); if (_hh) _hh.style.display = 'none';
            const _cb = document.getElementById('cameraBox'); if (_cb) _cb.classList.remove('show-hand-zone', 'hand-in-zone');
            // The static Step-1 sub-header is gesture-ceremony copy ("Say a greeting, then show
            // each number...") — false for a quiet still. Swap it for fast-accurate copy so the
            // pre-flight reads consistently (FULL keeps the static gesture copy via the markup).
            // F-654: derive the copy from the POLICY, not a hardcode. The fast tier's policy is
            // [face_embedding, bound_digit, passive_liveness] — face AND one bound digit — so the
            // copy must state BOTH (Rob: it said "one photo confirms it's you" but the flow also
            // asks for a finger). reauthPolicyHasBoundDigit() may be null here if the challenge
            // hasn't been fetched yet — default to the honest face+number copy for the fast tier.
            const _hs = document.getElementById('step2HeaderSub');
            if (_hs) {
                var _hasDigit = reauthPolicyHasBoundDigit();
                _hs.textContent = (_hasDigit === false)
                    ? 'Hold still for a quick face check — one photo confirms it\u2019s you.'
                    // F-755i: 'beside your cheek' — consistent with the full-flow pre-flight copy.
                    // F-783a: the fast tier is a BOUND digit (show AND say — the server also runs an
                    // audio check). The old show-only copy caused live false-denies (Rob showed but
                    // didn't speak). State both halves until the pre-flight can render from the
                    // fetched challenge's bound_instruction (F-654-COMPLETE).
                    : 'Quick camera & mic check \u2014 next, you\u2019ll show a number beside your cheek and say it out loud.';
                _hs.style.fontSize = 'clamp(14px, 4vw, 17px)'; _hs.style.color = 'var(--text-primary)'; _hs.style.fontWeight = '600'; _hs.style.maxWidth = '460px';
            }
        }
    } catch(_) {}
    // Set up audio analyser
    try {
        avAudioCtx = new AudioContext();
        if (avAudioCtx.state === 'suspended') avAudioCtx.resume();
        avAnalyser = avAudioCtx.createAnalyser();
        avAnalyser.fftSize = 256;
        // F-755d: do NOT clone — iOS Safari cloned track is dead (reads flat 0%).
        // Build source from the original audio track directly.
        const _atrk = mediaStream.getAudioTracks()[0];
        const source = avAudioCtx.createMediaStreamSource(_atrk ? new MediaStream([_atrk]) : mediaStream);
        source.connect(avAnalyser);
        // S154 fix-on-find (F-1025 spirit): show the ACTUAL input device label during
        // pre-flight — a silent wrong-device state (browser listening on the wrong
        // mic) was previously masked once the latched "Mic: working" chip stuck.
        try {
            const devEl = document.getElementById('avMicDevice');
            if (_atrk && devEl) { devEl.textContent = 'Listening through: ' + (_atrk.label || 'default microphone'); devEl.style.display = 'block'; }
        } catch (e2) { /* label unavailable pre-permission on some browsers */ }
    } catch (e) { console.warn('[AV] Audio analyser setup failed:', e); }

    // Create hidden canvas for brightness analysis
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d');

    let avLastCheck = 0;

    function runAVFrame() {
        const video = document.getElementById('videoPreview');
        if (!video || video.paused || video.readyState < 2) { avCheckFrame = requestAnimationFrame(runAVFrame); return; }

        // Audio bar runs every frame for smooth real-time feel
        if (avAnalyser) {
            if (avAudioCtx && avAudioCtx.state === 'suspended') avAudioCtx.resume();
            const dataArray = new Uint8Array(avAnalyser.fftSize);
            avAnalyser.getByteTimeDomainData(dataArray);
            let maxDev = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const dev = Math.abs(dataArray[i] - 128);
                if (dev > maxDev) maxDev = dev;
            }
            const level = Math.min(100, Math.round((maxDev / 128) * 100));
            _checkMicDeviceWarn(level);
            // F-941 (BUILD 393): frequency-spectrum data pulled every frame (not just when the
            // monitor draw below needs it) so the voice-band ratio is available to the
            // ambient-relative qualify check regardless of __vacGateArmed. bins 1-16 of 128
            // (fftSize 256 @ 48kHz, ~187Hz-3kHz) hold speech; a restaurant's clatter/HVAC floor
            // spreads flatter across the full spectrum, so this ratio separates "someone talking
            // in a loud room" from "the room itself got louder."
            const _fbuf = new Uint8Array(avAnalyser.frequencyBinCount);
            avAnalyser.getByteFrequencyData(_fbuf);
            let _speechRatio = 0;
            {
                let _bandSum = 0, _totalSum = 0;
                for (let i = 0; i < _fbuf.length; i++) {
                    _totalSum += _fbuf[i];
                    if (i >= 1 && i <= 16) _bandSum += _fbuf[i];
                }
                _speechRatio = _totalSum > 0 ? (_bandSum / _totalSum) : 0;
            }
            // D-VAD-UNITS (task-447→task-644): the ceremony VAD's comparison quantity — same units
            // as _startSpeechGate's digit tick and _phraseVadTick. task-644 switches all three from
            // frequency-domain (was "VERBATIM from _fbuf", broken on iOS Safari where getByteFrequencyData
            // returns ~0.01 forever) to time-domain RMS: dataArray (filled above via getByteTimeDomainData)
            // gives √mean((v-128)²)/128, which reads real amplitude on iOS and matches the VAD gate ticks.
            let _ceremonyRms = 0;
            for (let i = 0; i < dataArray.length; i++) { const _cv = dataArray[i] - 128; _ceremonyRms += _cv * _cv; }
            _ceremonyRms = Math.sqrt(_ceremonyRms / dataArray.length) / 128;
            // S145e (Rob): the Mic-pill VU must run in EVERY phase — greeting included — regardless
            // of which gate loop this flow uses. When no gate is driving it, this always-on monitor
            // does, with rms computed the same way the VAD measures it (so the gold line means the
            // same thing all ceremony). Tag m = monitor-driven.
            try {
                if (!window.__vacGateArmed) { var _svx = document.getElementById('vacStepVU'); if (_svx) _svx.remove(); }
                if (!window.__vacGateArmed && window.__vacMicPillDraw) {
                    // S429: MUST be the SAME quantity the pass/fail gate below judges — TIME-domain
                    // `level` — with the gold line at the LIVE qualify floor, not a hardcoded 0.115.
                    // The prior draw used FREQUENCY-domain rms against a fixed threshold: broadband
                    // wind/HVAC lifts frequency-rms, so the bar read "loud enough" exactly when the
                    // time-domain level the gate actually reads was starving (outdoor false-deny).
                    // The floor mirrors the FULL qualify formula below (rolling-2s ambient median
                    // AND seeded ambient, not just the seed) — a meter that only showed the seed
                    // term could read "past the line" while the real gate (which also weighs recent
                    // ambient) still failed it, coaching the user wrong (codex adversarial review).
                    // `level` and the floor are both 0-100 scale; /100 puts them on the pill's 0-1 scale.
                    const _voicedNow = _speechRatio >= VOICE_BAND_MIN_RATIO;
                    const _histSorted = _micLevelHistory.map(function(e){ return e.level; }).sort(function(a,b){ return a - b; });
                    const _histAmbientMedian = _histSorted.length ? _histSorted[Math.floor(_histSorted.length / 2)] : 0;
                    const _liveFloor = Math.max((_voicedNow ? 1.15 : 2) * _histAmbientMedian, _micQualifyFloor(_voicedNow));
                    window.__vacMicPillDraw(level / 100, _liveFloor / 100, 'm');
                }
            } catch(_) {}
            const bar = document.getElementById('avAudioLevel');
            const pct = document.getElementById('avAudioPct');
            bar.style.width = level + '%';
            pct.textContent = level + '%';
            // F-755d: always-visible RMS readout in the Mic pill so Rob can see level on iPhone
            // F-941 (BUILD 393): append the voice-band ratio so the debug readout shows WHY a
            // loud-room run does or doesn't qualify at the reduced multiplier, not just the level.
            const _rmsEl = document.getElementById('avRmsReadout');
            if (_rmsEl && !window.__vacGateArmed) _rmsEl.textContent = '(' + level + '% · voice ' + Math.round(_speechRatio * 100) + '%)';
            if (level > 80) { bar.style.background = 'var(--error)'; }
            else if (level > 50) { bar.style.background = 'var(--warning)'; }
            else if (level > 5) { bar.style.background = 'var(--success)'; }
            else { bar.style.background = 'var(--text-quaternary)'; }
            // T-329c (S145 Finding 2): "Mic: working" must mean the USER's speech was heard during
            // the speak-now prompt, clear of the ambient floor — not just "12% crossed at some
            // point" (restaurant ambient alone latched the old absolute-only F-755f bar). Require a
            // SUSTAINED run (still >= 3 consecutive frames above 12%) whose median level beats 2x
            // the median of the preceding 2s of levels (ambient-relative, not absolute). A ticked
            // pill can also regress back to pending if 10s pass with no fresh qualifying run.
            const _nowT = performance.now();
            // GATE-343 f2: seed a real ambient baseline from the first 1.5s of frames right after
            // mic-open, before any prompt — so a ceremony STARTING in noise has something other
            // than 0 to compare against (see qualify check below).
            if (!_micSeeded) {
                if (_micSeedStartT === 0) _micSeedStartT = _nowT;
                _micSeedLevels.push(level);
                _micSeedRmsSamples.push(_ceremonyRms);  // D-VAD-UNITS: ceremony-scale twin, same seed window
                if (_nowT - _micSeedStartT >= 1500) {
                    const _seedSorted = _micSeedLevels.slice().sort((a, b) => a - b);
                    _micSeededAmbient = _seedSorted.length ? _seedSorted[Math.floor(_seedSorted.length / 2)] : 0;
                    const _seedRmsSorted = _micSeedRmsSamples.slice().sort((a, b) => a - b);
                    _micSeededAmbientRms = _seedRmsSorted.length ? _seedRmsSorted[Math.floor(_seedRmsSorted.length / 2)] : 0;
                    _micSeeded = true;
                }
            }
            _micLevelHistory.push({ t: _nowT, level });
            while (_micLevelHistory.length && _micLevelHistory[0].t < _nowT - 2000) _micLevelHistory.shift();
            // S429: collect relative to the SAME qualify floor the run is later judged against
            // (_micQualifyFloor — ambient-relative, voice-band-aware), not a flat 12. The flat 12
            // was an unreachable absolute for a voice-shaped run that qualifies from 8 (Rob at 9%
            // outdoors never accumulated a single frame) — every frame below it was discarded and
            // _micLoudFrames reset, so the lower qualify floor downstream was dead code. The strict
            // 2x-ambient path for non-voice-shaped runs is unchanged (still floors at 12).
            // Voice-shaped classification uses the RUN'S OWN accumulated ratio median once a run is
            // underway (not just this single frame's instantaneous ratio) — the final qualify check
            // already judges the whole run by its median ratio, so gating single frames on a noisy
            // instantaneous sample let ordinary formant dips flip a frame to the stricter threshold
            // mid-utterance and spuriously reset an otherwise-voiced run (codex adversarial review).
            // A brand-new run (no ratio history yet) still decides on this frame's own ratio.
            const _runRatioSoFar = _micRunRatios.length
                ? _micRunRatios.slice().sort((a, b) => a - b)[Math.floor(_micRunRatios.length / 2)]
                : _speechRatio;
            if (level > _micQualifyFloor(_runRatioSoFar >= VOICE_BAND_MIN_RATIO)) {
                if (_micLoudFrames === 0) _micRunStartT = _nowT;
                _micLoudFrames++;
                _micRunLevels.push(level);
                _micRunRatios.push(_speechRatio);
                _micRunRmsSamples.push(_ceremonyRms);  // D-VAD-UNITS: ceremony-scale twin, same qualifying run
            } else {
                _micLoudFrames = 0;
                _micRunLevels = [];
                _micRunRatios = [];
                _micRunRmsSamples = [];
            }
            if (_micLoudFrames >= 3 && _micSeeded) {
                // GATE-343 f2: hold qualification until the seed window has closed — a run
                // completing WHILE seeding is still in progress means _micSeededAmbient is still
                // 0 (unmeasured), which is exactly the "starting in noise" false-tick this fix
                // targets. Withholding here means sustained ambient noise present at mic-open
                // gets folded into _micSeededAmbient instead of slipping through on the raw floor.
                const _ambient = _micLevelHistory.filter(e => e.t < _micRunStartT).map(e => e.level).sort((a, b) => a - b);
                const _ambientMedian = _ambient.length ? _ambient[Math.floor(_ambient.length / 2)] : 0;
                const _run = _micRunLevels.slice().sort((a, b) => a - b);
                const _runMedian = _run[Math.floor(_run.length / 2)];
                // GATE-343 f2: with no pre-run history (ceremony just started) _ambientMedian was
                // defaulting to 0, so any 3-frame run trivially "qualified" even in sustained
                // ambient noise. Floor the requirement at 2x the seeded startup ambient, and at an
                // absolute minimum, so a run can't qualify against a bare 0 baseline.
                // F-941 (BUILD 393): DUAL-PATH — a run whose energy sits mostly in the voice band
                // (median speechRatio >= VOICE_BAND_MIN_RATIO) qualifies against a REDUCED 1.15x
                // ambient multiplier instead of 2x, because voice-shaped energy shouldn't need to
                // out-shout a restaurant's flat broadband floor. This is a substitution, not an
                // added AND condition — a run that isn't voice-band-dominant still only needs the
                // existing strict 2x path (unchanged), so loud non-speech rooms don't get easier.
                const _ratioSorted = _micRunRatios.slice().sort((a, b) => a - b);
                const _runRatioMedian = _ratioSorted.length ? _ratioSorted[Math.floor(_ratioSorted.length / 2)] : 0;
                const _runVoiced = _runRatioMedian >= VOICE_BAND_MIN_RATIO;
                const _ambientMult = _runVoiced ? 1.15 : 2;
                // S429: seeded-ambient + floor term now lives in the shared _micQualifyFloor (also
                // used by the collector gate above and the live meter), so this can't drift from
                // what fed it. The local pre-run ambientMedian term is unchanged.
                const _qualifyFloor = Math.max(_ambientMult * _ambientMedian, _micQualifyFloor(_runVoiced));
                if (_runMedian > _qualifyFloor) {
                    _micLastQualifyT = _nowT;
                    // D-VAD-CALIBRATION-GREETING-BOUND: this run just proved it's THIS user's
                    // speaking level over THIS room's ambient — persist it so the ceremony VAD
                    // can arm from it (see _micPreflightVad).
                    _micSeededSpeechLevel = _runMedian;
                    const _runRmsSorted = _micRunRmsSamples.slice().sort((a, b) => a - b);
                    _micSeededSpeechRms = _runRmsSorted.length ? _runRmsSorted[Math.floor(_runRmsSorted.length / 2)] : 0;  // D-VAD-UNITS: ceremony-scale twin of _runMedian, same run
                    if (!avChecks.mic) {
                        setAVStatus('mic', 'good', 'Mic: working');
                        avChecks.mic = true;
                    }
                }
            }
            if (avChecks.mic && _nowT - _micLastQualifyT > 10000) {
                avChecks.mic = false;
                _micLastQualifyT = 0;
                setAVStatus('mic', 'checking', 'Mic');
                const _mpt = document.getElementById('avMicPromptText');
                if (_mpt) _mpt.textContent = 'Speak now to test your microphone';
                micWaitStart = 0;
            }
        }

        // Face + light checks throttled to ~4fps — prevents jitter
        const now = performance.now();
        if (now - avLastCheck >= 250) {
            avLastCheck = now;

        // 1. Brightness check
        try {
            ctx.drawImage(video, 0, 0, 160, 90);
            const imgData = ctx.getImageData(0, 0, 160, 90).data;
            let totalBright = 0;
            for (let i = 0; i < imgData.length; i += 16) {
                totalBright += (0.299 * imgData[i] + 0.587 * imgData[i+1] + 0.114 * imgData[i+2]);
            }
            const avgBright = Math.round(totalBright / (imgData.length / 16));
            document.getElementById('avLuxValue').textContent = '(' + avgBright + ')';

            if (avgBright < 50) {
                setAVStatus('light', 'bad', 'Light: too dark');
                avChecks.light = false;
            } else if (avgBright < 80) {
                setAVStatus('light', 'warn', 'Light: dim');
                avChecks.light = true; // Acceptable
            } else if (avgBright > 220) {
                setAVStatus('light', 'warn', 'Light: too bright');
                avChecks.light = false;
            } else {
                setAVStatus('light', 'good', 'Light: good');
                avChecks.light = true;
            }

        } catch (e) { /* canvas errors are non-fatal */ }
        // task-432 Part 1: refresh the face-anchor estimate at the same ~4fps cadence — feeds
        // _activeZone() so the pre-flight practice oval matches the real gesture-step geometry.
        try { _updateFaceAnchor(video); } catch(_) {}
        } // end throttle block

        // S110 (F-559): hand pre-flight. Run the SAME FingerDetector here so the user
        // sees the skeleton (the "impress" moment), confirms detection works, AND the
        // model warms up — so the first finger in the challenge isn't laggy. Additive:
        // separate video (videoPreview), separate overlay (avHandOverlay); does NOT
        // touch the in-challenge loop. Guarded — never blocks Proceed.
        try {
            // FAST still skips the hand pre-flight entirely (no show-hand-zone add, no
            // hand detection, no "hold your hand up" hint, no avChecks.hand gating) — the
            // fast verdict is face + the bound digit, a quiet still. FULL/clip (_fastStill
            // false) runs the unchanged hand practice. _fastStill is the SAME flag set in
            // startAVChecks (runAVFrame is its closure).
            if (!_fastStill && FingerDetector.ready) {
                const pv = document.getElementById('videoPreview');
                const n = FingerDetector.detect(pv);          // warms the model + gives landmarks
                const lm = FingerDetector.landmarks;
                _avDrawHand(pv, lm);
                // Show the SAME wider dotted oval the real gesture step uses (hides #faceOval),
                // so the practice screen trains the in-front-of-face constraint.
                const _camBox = document.getElementById('cameraBox');
                _camBox.classList.add('show-hand-zone');
                const _near = !!lm && _handNearFaceZone(lm);   // SHARED check — same as the real screen (glow/class)
                const _tickNear = !!lm && _handInTickZone(lm); // F-755h: wider zone gates the Hand✓ tick
                _camBox.classList.toggle('hand-in-zone', _near);
                if (avChecks.hand) {
                    // T-329a (S145 finding 1): LATCHED is no longer permanent. Ready must stay
                    // backed by zone-ACCEPTED detection (_handNearFaceZone, the real acceptance
                    // gate — not the wider tick zone). Sustained loss (>=10 consecutive frames
                    // without _near) regresses back to pending, so a phantom/dropped-hand can't
                    // ride a stale ✓ (the "All set" false-ready finding).
                    if (_near) {
                        _handUnstableFrames = 0;
                        if (_handGraceStartT) { _handGraceStartT = 0; setAVStatus('hand','good','Hand ✓'); }
                        document.getElementById('avHandHint').style.display='none';
                    } else {
                        // F-929 (Rob, S147): bounded grace window — readiness survives a hand-drop for a
                        // VISIBLE, time-boxed 3s (countdown on the chip) so a one-handed phone user can
                        // reach Start. Honesty preserved: explicit, bounded, and the hand returning
                        // cancels the countdown back to steady ✓. On expiry, full regression as before.
                        if (!_handGraceStartT) _handGraceStartT = performance.now();
                        const _gLeft = AV_HAND_GRACE_MS - (performance.now() - _handGraceStartT);
                        if (_gLeft > 0) {
                            setAVStatus('hand','good','Hand \u2713 \u2014 start within ' + Math.ceil(_gLeft/1000) + 's');
                        } else {
                            _handGraceStartT = 0;
                            avChecks.hand = false;
                            _handStableFrames = 0;
                            _handUnstableFrames = 0;
                            setAVStatus('hand','warn','Hand: beside your cheek');
                            document.getElementById('avHandHint').textContent='✋ Move your hand beside your cheek';
                            document.getElementById('avHandHint').style.display='block';
                        }
                    }
                } else if (lm) {
                    // well-framed? (reuse the same edge logic as the in-challenge guard)
                    let minX=1,maxX=0,minY=1,maxY=0;
                    for (const p of lm){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
                    const clipped = (minX<0.04||maxX>0.96||minY<0.04||maxY>0.96);
                    const tooBig = ((maxX-minX)>0.85||(maxY-minY)>0.9);
                    // L-2299: tooSmall replaced by zone check — coaching is position-correct, not just distance.
                    // F-758: on-screen readout so Rob can tune the hand gate from real data (tick-zone vs framing).
                    try { if (typeof QA !== 'undefined' && QA && QA.on) { var _dbg = document.getElementById('vacHandDbg'); if (_dbg) _dbg.textContent = 'tick:'+(_tickNear?'Y':'N')+' size:'+((maxX-minX).toFixed(2))+'×'+((maxY-minY).toFixed(2))+' stable:'+_handStableFrames; } } catch(_){}
                    if (!_tickNear) {
                        // Hand visible but OUTSIDE the wide tick zone — prompt to move beside cheek.
                        _handStableFrames = 0;
                        setAVStatus('hand','warn','Hand: beside your cheek'); document.getElementById('avHandHint').textContent='✋ Move your hand beside your cheek'; document.getElementById('avHandHint').style.display='block';
                    } else if (clipped || tooBig) { _handStableFrames = 0; setAVStatus('hand','warn','Hand: move back'); document.getElementById('avHandHint').textContent='Move your hand back — keep the whole hand in view'; document.getElementById('avHandHint').style.display='block'; }
                    else {
                        // F-755b: completeness floor — phantom (partial landmarks) must not pass readiness
                        // F-755d/T-329a: stability gate — require 5 consecutive frames that are BOTH
                        // complete AND zone-ACCEPTED (_near, the real _handNearFaceZone gate — not just
                        // the wider tick zone) so a flickering face-phantom never reaches the ✓ tick.
                        let _ckFin = lm.length === 21;
                        if (_ckFin) { for (let _ci = 0; _ci < 21 && _ckFin; _ci++) { if (!lm[_ci] || !Number.isFinite(lm[_ci].x) || !Number.isFinite(lm[_ci].y)) _ckFin = false; } }
                        if (_ckFin && _near) {
                            _handStableFrames++;
                            if (_handStableFrames >= 5) {
                                setAVStatus('hand','good','Hand ✓'); avChecks.hand = true; _handUnstableFrames = 0; _handGraceStartT = 0; document.getElementById('avHandHint').style.display='none';
                            } else {
                                setAVStatus('hand','warn','Hold steady…'); document.getElementById('avHandHint').textContent='Hold steady…'; document.getElementById('avHandHint').style.display='block';
                            }
                        } else if (_ckFin) { _handStableFrames = 0; setAVStatus('hand','warn','Hand: beside your cheek'); document.getElementById('avHandHint').textContent='✋ Move your hand beside your cheek'; document.getElementById('avHandHint').style.display='block'; }
                        else { _handStableFrames = 0; setAVStatus('hand','warn','Hand: spread fingers'); document.getElementById('avHandHint').textContent='Spread your fingers — make sure all are clearly visible'; document.getElementById('avHandHint').style.display='block'; }
                    }
                } else {
                    _handStableFrames = 0;
                    _camBox.classList.remove('hand-in-zone');
                    document.getElementById('avHandHint').style.display='block';
                    document.getElementById('avHandHint').textContent='Hold your hand beside your cheek — we’ll show it tracked';
                }
            }
        } catch(_) { /* hand pre-flight is best-effort; never block */ }

        // Update proceed button
        updateAVReady();
        updateMicTips();
        avCheckFrame = requestAnimationFrame(runAVFrame);
    }
    avCheckFrame = requestAnimationFrame(runAVFrame);
}

// S110 (F-559): draw the hand skeleton on the pre-flight camera (the "impress" moment).
const _AV_HAND_CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

// Lane A — two-zone capture: canonical spread-finger pose templates.
// 21 normalized {x,y} landmarks per count (MediaPipe hand model order, 0=wrist).
// Fingers are INDEX(5-8), MIDDLE(9-12), RING(13-16), PINKY(17-20), THUMB(1-4).
// Extended = upward; folded = curled toward palm. All in normalized [0,1] space
// centered within the hand zone (cx=0.50, cy≈0.50, zone is 64%×80% of the frame).
// These are DISPLAY-ONLY canvas overlays — never composited into captured frames.
const _FINGER_GUIDE_LM = [
    // 0 — fist (all folded)
    [{x:.50,y:.78},{x:.38,y:.70},{x:.30,y:.70},{x:.36,y:.68},{x:.42,y:.66},
     {x:.40,y:.61},{x:.42,y:.57},{x:.44,y:.62},{x:.44,y:.65},
     {x:.48,y:.59},{x:.50,y:.55},{x:.50,y:.61},{x:.50,y:.63},
     {x:.56,y:.61},{x:.56,y:.56},{x:.56,y:.61},{x:.55,y:.63},
     {x:.63,y:.64},{x:.62,y:.58},{x:.61,y:.63},{x:.59,y:.65}],
    // 1 — index only
    [{x:.50,y:.78},{x:.38,y:.70},{x:.30,y:.70},{x:.36,y:.68},{x:.42,y:.66},
     {x:.40,y:.61},{x:.37,y:.49},{x:.35,y:.39},{x:.34,y:.30},
     {x:.48,y:.59},{x:.50,y:.55},{x:.50,y:.61},{x:.50,y:.63},
     {x:.56,y:.61},{x:.56,y:.56},{x:.56,y:.61},{x:.55,y:.63},
     {x:.63,y:.64},{x:.62,y:.58},{x:.61,y:.63},{x:.59,y:.65}],
    // 2 — index + middle
    [{x:.50,y:.78},{x:.38,y:.70},{x:.30,y:.70},{x:.36,y:.68},{x:.42,y:.66},
     {x:.40,y:.61},{x:.37,y:.49},{x:.35,y:.39},{x:.34,y:.30},
     {x:.48,y:.59},{x:.46,y:.46},{x:.45,y:.36},{x:.44,y:.27},
     {x:.56,y:.61},{x:.56,y:.56},{x:.56,y:.61},{x:.55,y:.63},
     {x:.63,y:.64},{x:.62,y:.58},{x:.61,y:.63},{x:.59,y:.65}],
    // 3 — index + middle + ring
    [{x:.50,y:.78},{x:.38,y:.70},{x:.30,y:.70},{x:.36,y:.68},{x:.42,y:.66},
     {x:.40,y:.61},{x:.37,y:.49},{x:.35,y:.39},{x:.34,y:.30},
     {x:.48,y:.59},{x:.46,y:.46},{x:.45,y:.36},{x:.44,y:.27},
     {x:.56,y:.61},{x:.57,y:.49},{x:.57,y:.39},{x:.58,y:.31},
     {x:.63,y:.64},{x:.62,y:.58},{x:.61,y:.63},{x:.59,y:.65}],
    // 4 — index + middle + ring + pinky
    [{x:.50,y:.78},{x:.38,y:.70},{x:.30,y:.70},{x:.36,y:.68},{x:.42,y:.66},
     {x:.40,y:.61},{x:.37,y:.49},{x:.35,y:.39},{x:.34,y:.30},
     {x:.48,y:.59},{x:.46,y:.46},{x:.45,y:.36},{x:.44,y:.27},
     {x:.56,y:.61},{x:.57,y:.49},{x:.57,y:.39},{x:.58,y:.31},
     {x:.63,y:.64},{x:.65,y:.54},{x:.67,y:.46},{x:.68,y:.39}],
    // 5 — all (thumb extended)
    [{x:.50,y:.78},{x:.38,y:.70},{x:.32,y:.64},{x:.26,y:.57},{x:.22,y:.51},
     {x:.40,y:.61},{x:.37,y:.49},{x:.35,y:.39},{x:.34,y:.30},
     {x:.48,y:.59},{x:.46,y:.46},{x:.45,y:.36},{x:.44,y:.27},
     {x:.56,y:.61},{x:.57,y:.49},{x:.57,y:.39},{x:.58,y:.31},
     {x:.63,y:.64},{x:.65,y:.54},{x:.67,y:.46},{x:.68,y:.39}],
];

// Draw a high-contrast dashed target guide for digit n on an existing 2D context (already sized).
// Called BEFORE the live skeleton so the solid live hand paints on top.
// SECURITY: operates on a canvas 2D context only — never called with a captured-frame canvas.
function _guideSide(lm){
    if (!lm || !lm.length) return 'right';
    var _sx = 0; for (var _si = 0; _si < lm.length; _si++) _sx += lm[_si].x;
    return (_sx / lm.length) < 0.5 ? 'left' : 'right';
}
// F-755: static purple oval guide — replaces the live hand-skeleton template.
// Two ovals, one beside each cheek (clear of the face-oval RX=0.32 RY=0.40).
// lm (optional 6th arg): current MediaPipe landmarks; drives the confident glow when
// all 21 are finite AND _handNearFaceZone passes. Advisory UX only — no verdict impact.
function _drawFingerTargetGuide(ctx, w, h, n, side, lm) {
    // _lmComplete: 21 finite landmarks — governs skeleton draw (no zone check).
    // _confident: adds zone check for the oval glow (advisory only).
    var _lmComplete = false;
    var _confident = false;
    if (lm && lm.length === 21) {
        var _allFin = true;
        for (var _li = 0; _li < 21 && _allFin; _li++) {
            if (!lm[_li] || !Number.isFinite(lm[_li].x) || !Number.isFinite(lm[_li].y)) _allFin = false;
        }
        if (_allFin) { _lmComplete = true; try { _confident = _handNearFaceZone(lm); } catch(_){} }
    }
    // Two ovals, one beside each cheek — geometry from _activeZone() (task-432 Part 1:
    // face-anchored when a confident face read exists, else GESTURE_ZONE_SPEC's fallback).
    var _zone = _activeZone();
    var _ovals = _zone.ovals, _radX = _zone.rx, _radY = _zone.ry;
    // task-646: double-stroke halo — precompute pulse once per frame for all ovals.
    var _dpr646 = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
    var _t646 = (typeof performance !== 'undefined' ? performance.now() : 0);
    var _pulse646 = 0.65 + 0.35 * (1 + Math.cos(2 * Math.PI * _t646 / 1200)) / 2;
    var _dashL646 = Math.max(10, w * 0.024), _gapL646 = Math.max(5, w * 0.012);
    ctx.save();
    try {
        for (var _oi = 0; _oi < _ovals.length; _oi++) {
            var _ov = _ovals[_oi];
            var _active = (_ov.side === side);
            var _glow = _active && _confident;
            var _cx = _ov.cx * w, _ocx2 = _ov.cy * h;
            var _rx = _radX * w, _ry = _radY * h;
            // F-755h2: only ONE oval reads as the target — the active side is bright,
            // the inactive side is heavily dimmed so it never looks like "use both hands".
            ctx.beginPath();
            ctx.ellipse(_cx, _ocx2, _rx, _ry, 0, 0, 6.283);
            if (_active) {
                if (_glow) {
                    // task-432 Part 3: hand IN zone — solid green confirmation, instant-reversing.
                    ctx.fillStyle = 'rgba(0,184,148,0.32)'; ctx.shadowColor = '#00b894';
                    ctx.shadowBlur = Math.max(18, w * 0.04); ctx.fill();
                    ctx.strokeStyle = '#00b894'; ctx.lineWidth = Math.max(3, w * 0.006);
                    ctx.shadowBlur = Math.max(10, w * 0.02); ctx.setLineDash([]); ctx.stroke();
                } else {
                    // task-646: zone EMPTY — double-stroke halo reads on both bright and dark feeds.
                    ctx.fillStyle = 'rgba(108,92,231,0.12)'; ctx.shadowBlur = 0; ctx.fill();
                    ctx.strokeStyle = 'rgba(10,15,26,0.85)';
                    ctx.lineWidth = Math.max(3 * _dpr646, w * 0.006);
                    ctx.setLineDash([_dashL646, _gapL646]); ctx.globalAlpha = _pulse646; ctx.stroke();
                    ctx.strokeStyle = 'rgba(212,169,78,0.95)';
                    ctx.lineWidth = Math.max(2 * _dpr646, w * 0.003);
                    ctx.globalAlpha = _pulse646; ctx.stroke();
                    ctx.globalAlpha = 1; ctx.setLineDash([]);
                }
            } else {
                // inactive: faint ghost only
                ctx.fillStyle = 'rgba(108,92,231,0.03)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(108,92,231,0.18)';
                ctx.lineWidth = Math.max(1, w * 0.002);
                ctx.setLineDash([Math.max(3, w*0.008), Math.max(3, w*0.008)]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
        }
        // F-755g: skeleton draws whenever 21 finite landmarks are present — zone is a soft oval hint only.
        if (_lmComplete && lm) {
            ctx.strokeStyle = 'rgba(0,206,201,0.85)';
            ctx.lineWidth = Math.max(4, w * 0.008);
            for (var _sci = 0; _sci < _AV_HAND_CONN.length; _sci++) {
                var _sa = _AV_HAND_CONN[_sci][0], _sb = _AV_HAND_CONN[_sci][1];
                ctx.beginPath(); ctx.moveTo(lm[_sa].x * w, lm[_sa].y * h); ctx.lineTo(lm[_sb].x * w, lm[_sb].y * h); ctx.stroke();
            }
            var _sr = Math.max(5, w * 0.011);
            for (var _sj = 0; _sj < lm.length; _sj++) {
                ctx.beginPath(); ctx.arc(lm[_sj].x * w, lm[_sj].y * h, _sr, 0, 7); ctx.fillStyle = '#6C5CE7'; ctx.fill();
            }
        }
        // Text prompt — counter-flip so words read forward (canvas has CSS scaleX(-1); ovals/skeleton stay mirrored)
        var _n0 = (typeof n === 'number' && Number.isFinite(n)) ? Math.round(n) : -1;
        // F-761: coach the pose for the ambiguous 4↔5 pair — a relaxed hand (thumb close to fingers)
        // reads as 4-or-5 unreliably. 5 → spread wide; 4 → tuck thumb. Others are visually distinct.
        // task-432 Part 3: once the hand is ACCEPTED, swap the positioning instruction for an
        // unmissable confirmation — the user is mid-pose and about to speak, so this must read at
        // a glance, in peripheral vision, without asking them to refocus on the caption. codex
        // review (round 5): the confirmation is zone-only (position), not gesture-correctness —
        // a wrong finger count in the right spot must not read as "you're done." Keep the target
        // digit in the message so the required count is never hidden behind the confirmation.
        var _msg = _confident ? (_n0 > 0 ? 'Show ' + _n0 + ' — hand in place, hold it there' : 'Hand in place — hold it there')
                 : _n0 === 0 ? 'Make a fist beside your cheek'
                 : _n0 === 5 ? 'Show 5 — spread your fingers WIDE, beside your cheek'
                 : _n0 === 4 ? 'Show 4 — tuck your thumb in, beside your cheek'
                 : _n0 > 0  ? 'Hold ' + _n0 + ' finger' + (_n0 === 1 ? '' : 's') + ' beside your cheek'
                 :             'Hold your hand beside your cheek';
        var _fs = Math.max(13, Math.min(Math.round(w * 0.036), 26));
        ctx.save();
        try {
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            ctx.font = 'bold ' + _fs + 'px -apple-system,BlinkMacSystemFont,sans-serif';
            // F-759: shrink to fit — never let the caption exceed ~90% of the canvas width (was squashing)
            var _maxW = w * 0.9;
            var _measured = ctx.measureText(_msg).width;
            if (_measured > _maxW) { _fs = Math.max(11, Math.floor(_fs * _maxW / _measured)); ctx.font = 'bold ' + _fs + 'px -apple-system,BlinkMacSystemFont,sans-serif'; }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            var _tx = w * 0.5, _ty = Math.max(28, h * 0.055);
            var _tw = ctx.measureText(_msg).width;
            var _pad = Math.max(8, w * 0.018);
            ctx.fillStyle = _confident ? 'rgba(0,60,45,0.82)' : 'rgba(0,0,0,0.68)';
            ctx.fillRect((w - _tx) - _tw / 2 - _pad, _ty - _fs * 0.75, _tw + _pad * 2, _fs * 1.5);
            ctx.shadowColor = 'rgba(0,0,0,0.85)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            ctx.fillStyle = _confident ? '#00e0a8' : 'rgba(255,214,10,0.97)';
            ctx.fillText(_msg, w - _tx, _ty);
        } finally { ctx.restore(); }
        // F-755d: per-frame zone readout — Rob's iPhone visual verification
        if (lm && lm.length >= 1 && lm[0] && Number.isFinite(lm[0].x)) {
            ctx.save();
            try {
                ctx.translate(w, 0); ctx.scale(-1, 1);
                var _zfs = Math.max(10, Math.min(Math.round(w * 0.028), 15));
                ctx.font = 'bold ' + _zfs + 'px monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                var _zm = _confident ? 'ZONE: IN ✓' : 'ZONE: OUT';
                // task-handzone-faceanchored: show palm-centre (the actual test point) not wrist
                var _pcxd = (lm.length >= 18 && Number.isFinite(lm[5].x) && Number.isFinite(lm[9].x) && Number.isFinite(lm[13].x) && Number.isFinite(lm[17].x)) ? (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4 : null;
                var _pcyd = (_pcxd != null && Number.isFinite(lm[5].y) && Number.isFinite(lm[9].y) && Number.isFinite(lm[13].y) && Number.isFinite(lm[17].y)) ? (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4 : null;
                var _wsub = (_pcxd != null && _pcyd != null) ? 'palm(' + _pcxd.toFixed(2) + ',' + _pcyd.toFixed(2) + ')' : 'wrist(' + lm[0].x.toFixed(2) + ',' + lm[0].y.toFixed(2) + ')';
                var _mw = Math.max(ctx.measureText(_zm).width, ctx.measureText(_wsub).width) + 8;
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.fillRect(6, h - _zfs * 2.6 - 6, _mw, _zfs * 2.6 + 4);
                ctx.fillStyle = _confident ? '#00b894' : '#dfe6e9';
                ctx.fillText(_zm, 8, h - _zfs * 1.3 - 2);
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.fillText(_wsub, 8, h - 4);
            } finally { ctx.restore(); }
        }
    } finally { ctx.restore(); }
}
// S145 finding 3 (THIN-329b): consecutive-frame streak gating the AV pre-flight skeleton
// DRAW (separate from _handStableFrames, which gates the Hand✓ readiness pill). One bad
// frame — incomplete landmarks or an implausible wrist — clears it back to zero.
// S145 finding 4 (THIN-329d): the streak above is CANDIDATE-BLIND — it counts any
// plausible frame regardless of WHERE the wrist is, so with numHands:1 flipping
// frame-to-frame between a lingering phantom and a freshly-raised real hand, the
// phantom's long-held streak keeps winning the draw even once the real hand starts
// appearing. Track the streak PER candidate position (wrist proximity = same hand);
// a challenger must build a streak >= the incumbent's before it takes over — a
// stable real hand displaces a lingering phantom instead of flickering against it.
let _avActiveWrist = null, _avActiveStreak = 0;
let _avChallengerWrist = null, _avChallengerStreak = 0;
const _AV_CANDIDATE_DIST = 0.15; // normalized-coord radius treated as "the same hand"
// GATE-343 finding 4: the incumbent streak above was uncapped with no decay, so a
// long-lived phantom could never be out-streaked by a real hand (the challenger would
// need to match an ever-growing number). Cap the incumbent's effective streak and decay
// it by 1 on every frame it's absent or implausible; the challenger takes over once its
// streak exceeds the (possibly decayed) incumbent value, not merely equals it.
const _AV_INCUMBENT_STREAK_CAP = 12;
function _avDist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
function _avDrawHand(videoEl, lm){
    const cv=document.getElementById('avHandOverlay');
    if(!cv||!videoEl||!videoEl.videoWidth) return;
    if(!cv._ctx) cv._ctx=cv.getContext('2d');
    const ctx=cv._ctx;
    if(cv.width!==videoEl.videoWidth){ cv.width=videoEl.videoWidth; cv.height=videoEl.videoHeight; }
    ctx.clearRect(0,0,cv.width,cv.height);
    // F-755g: 21-finite check + zone membership computed BEFORE the oval draw (task-432 Part 3
    // needs _avZone to color the accepted oval green) — zone check itself never gates the skeleton draw.
    let _avLmFin = !!lm && lm.length === 21;
    if (_avLmFin) { for (let _fi = 0; _fi < 21 && _avLmFin; _fi++) { if (!lm[_fi] || !Number.isFinite(lm[_fi].x) || !Number.isFinite(lm[_fi].y)) _avLmFin = false; } }
    let _avZone = false;
    if (_avLmFin) { try { _avZone = _handNearFaceZone(lm); } catch(_) {} }
    // F-755e: draw cheek-zone ovals before the lm-guard so they show even with no hand up.
    // task-432 Part 1: geometry from _activeZone() (face-anchored when confident, else fallback) —
    // matches the acceptance gate and _drawFingerTargetGuide exactly, so marker and gate never drift.
    (function _drawAvCheekOvals(){
        const w=cv.width, h=cv.height;
        // F-755h2: only ONE oval reads as target (never "use both hands").
        // Pre-flight has no chosen digit-side, so light whichever cheek the hand is nearest;
        // if no hand yet, both are shown dim-equal so nothing implies "both hands".
        const _zone = _activeZone();
        let _wristX = null;
        if (lm && lm.length === 21 && lm[0] && Number.isFinite(lm[0].x)) _wristX = lm[0].x;
        const _nearSide = _wristX === null ? null : (_wristX < 0.5 ? _zone.ovals[0].cx : _zone.ovals[1].cx);
        const _gzRx = _zone.rx, _gzRy = _zone.ry;
        // task-646: double-stroke halo — precompute pulse once per frame for all ovals.
        const _dprAv = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
        const _tAv = (typeof performance !== 'undefined' ? performance.now() : 0);
        const _pulseAv = 0.65 + 0.35 * (1 + Math.cos(2 * Math.PI * _tAv / 1200)) / 2;
        const _dashLAv = Math.max(10, w * 0.024), _gapLAv = Math.max(5, w * 0.012);
        ctx.save();
        try {
        for (const _ov of _zone.ovals) {
            const cxN = _ov.cx;
            const _isActive = (_nearSide === null) ? null : (cxN === _nearSide);
            ctx.beginPath();
            ctx.ellipse(cxN*w, _ov.cy*h, _gzRx*w, _gzRy*h, 0, 0, Math.PI*2);
            if (_isActive === true) {
                // task-432 Part 3: unmissable, instant-reversing confirmation once the hand is
                // actually ACCEPTED (_avZone), not just nearest-side — mirrors the capture-step oval.
                if (_avZone) {
                    ctx.fillStyle='rgba(0,184,148,0.30)'; ctx.fill();
                    ctx.strokeStyle='#00b894'; ctx.lineWidth=Math.max(3,w*0.006);
                    ctx.setLineDash([]); ctx.stroke();
                } else {
                    // task-646: zone EMPTY — double-stroke halo reads on both bright and dark feeds.
                    ctx.fillStyle='rgba(108,92,231,0.16)'; ctx.fill();
                    ctx.strokeStyle='rgba(10,15,26,0.85)'; ctx.lineWidth=Math.max(3*_dprAv,w*0.006);
                    ctx.setLineDash([_dashLAv,_gapLAv]); ctx.globalAlpha=_pulseAv; ctx.stroke();
                    ctx.strokeStyle='rgba(212,169,78,0.95)'; ctx.lineWidth=Math.max(2*_dprAv,w*0.003);
                    ctx.globalAlpha=_pulseAv; ctx.stroke();
                    ctx.globalAlpha=1; ctx.setLineDash([]);
                }
            } else if (_isActive === false) {
                ctx.fillStyle='rgba(108,92,231,0.03)'; ctx.fill();
                ctx.strokeStyle='rgba(108,92,231,0.18)'; ctx.lineWidth=Math.max(1,w*0.002);
                ctx.setLineDash([Math.max(3,w*0.008),Math.max(3,w*0.008)]); ctx.stroke(); ctx.setLineDash([]);
            } else {
                // task-646: no hand yet — double-stroke halo on both ovals draws the eye to the targets.
                ctx.fillStyle='rgba(108,92,231,0.07)'; ctx.fill();
                ctx.strokeStyle='rgba(10,15,26,0.85)'; ctx.lineWidth=Math.max(3*_dprAv,w*0.006);
                ctx.setLineDash([_dashLAv,_gapLAv]); ctx.globalAlpha=_pulseAv; ctx.stroke();
                ctx.strokeStyle='rgba(212,169,78,0.95)'; ctx.lineWidth=Math.max(2*_dprAv,w*0.003);
                ctx.globalAlpha=_pulseAv; ctx.stroke();
                ctx.globalAlpha=1; ctx.setLineDash([]);
            }
        }
        } finally { ctx.restore(); }
    })();
    if(!lm) {
        _avActiveStreak = Math.max(0, _avActiveStreak - 1);
        if (_avActiveStreak === 0) _avActiveWrist = null;
        _avChallengerWrist = null; _avChallengerStreak = 0;
        return;
    }
    // S145 finding 3 (THIN-329b): a phantom detection jitters frame to frame and often lands
    // in the face band (top third of frame) — landmarks reaching this file already cleared the
    // model's own mid confidence floor (minHandDetectionConfidence/minHandPresenceConfidence
    // 0.5 in vac-finger-detect.js), so the residual signal available here is completeness +
    // wrist plausibility. Require the wrist inside the lower two-thirds of the frame, clear of
    // the edge margins, for >=4 consecutive frames before drawing at all; any single bad frame
    // (incomplete landmarks or an implausible wrist) clears the streak back to zero.
    const _avWrist = _avLmFin ? lm[0] : null;
    const _avWristPlausible = !!_avWrist && _avWrist.y >= (1 / 3) && _avWrist.x >= 0.04 && _avWrist.x <= 0.96;
    if (!_avLmFin || !_avWristPlausible) {
        _avActiveStreak = Math.max(0, _avActiveStreak - 1);
        if (_avActiveStreak === 0) _avActiveWrist = null;
        _avChallengerWrist = null; _avChallengerStreak = 0;
        return;
    }
    // THIN-329d selection: same position as the incumbent extends it (challenger lapses);
    // same position as the challenger grows it, promoting it once it exceeds the incumbent;
    // an unrecognized position starts a fresh challenger (incumbent holds, still drawn).
    // RE-GATE-352 finding 4 residual: an unrecognized position used to hard-overwrite an
    // EXISTING challenger to streak 1, so an actively-jittering phantom re-appearing at a
    // new stray spot every frame kept resetting a real hand's challenger streak before it
    // could out-build the incumbent. Give the challenger slot the same grace as the
    // incumbent: decay it by 1 on a miss and only evict (replace) it once it hits 0.
    if (_avActiveWrist && _avDist(_avActiveWrist, _avWrist) < _AV_CANDIDATE_DIST) {
        _avActiveWrist = _avWrist; _avActiveStreak = Math.min(_AV_INCUMBENT_STREAK_CAP, _avActiveStreak + 1);
        _avChallengerWrist = null; _avChallengerStreak = 0;
    } else if (_avChallengerWrist && _avDist(_avChallengerWrist, _avWrist) < _AV_CANDIDATE_DIST) {
        _avChallengerWrist = _avWrist; _avChallengerStreak++;
        if (_avChallengerStreak > _avActiveStreak) {
            _avActiveWrist = _avChallengerWrist; _avActiveStreak = _avChallengerStreak;
            _avChallengerWrist = null; _avChallengerStreak = 0;
        }
    } else if (!_avActiveWrist) {
        _avActiveWrist = _avWrist; _avActiveStreak = 1;
    } else if (_avChallengerWrist) {
        _avChallengerStreak = Math.max(0, _avChallengerStreak - 1);
        if (_avChallengerStreak === 0) { _avChallengerWrist = _avWrist; _avChallengerStreak = 1; }
    } else {
        _avChallengerWrist = _avWrist; _avChallengerStreak = 1;
    }
    // Only draw when THIS frame belongs to the current winning candidate — a
    // still-building challenger doesn't flash onto the overlay before it has won.
    if (_avActiveStreak < 4 || _avDist(_avActiveWrist, _avWrist) >= _AV_CANDIDATE_DIST) return;
    ctx.strokeStyle='rgba(0,206,201,0.85)'; ctx.lineWidth=Math.max(4,cv.width*0.008);
    for(const [a,b] of _AV_HAND_CONN){ ctx.beginPath(); ctx.moveTo(lm[a].x*cv.width,lm[a].y*cv.height); ctx.lineTo(lm[b].x*cv.width,lm[b].y*cv.height); ctx.stroke(); }
    const r=Math.max(5,cv.width*0.011);
    for(const p of lm){ ctx.beginPath(); ctx.arc(p.x*cv.width,p.y*cv.height,r,0,7); ctx.fillStyle='#6C5CE7'; ctx.fill(); }
    // F-755d: per-frame zone readout — Rob's iPhone visual verification
    if (lm[0] && Number.isFinite(lm[0].x)) {
        const _zw = cv.width, _zh = cv.height;
        ctx.save();
        try {
            ctx.translate(_zw, 0); ctx.scale(-1, 1);
            const _zfs = Math.max(10, Math.min(Math.round(_zw * 0.028), 15));
            ctx.font = 'bold ' + _zfs + 'px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            const _zm = _avZone ? 'ZONE: IN ✓' : 'ZONE: OUT';
            const _wsub = 'wrist(' + lm[0].x.toFixed(2) + ',' + lm[0].y.toFixed(2) + ')';
            const _mw = Math.max(ctx.measureText(_zm).width, ctx.measureText(_wsub).width) + 8;
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(6, _zh - _zfs * 2.6 - 6, _mw, _zfs * 2.6 + 4);
            ctx.fillStyle = _avZone ? '#00b894' : '#dfe6e9';
            ctx.fillText(_zm, 8, _zh - _zfs * 1.3 - 2);
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText(_wsub, 8, _zh - 4);
        } finally { ctx.restore(); }
    }
}

// F-654: TOP-LEVEL shared hand-skeleton drawer for the RECORDING camera box (handOverlay),
// so the fast quick-reauth draws the SAME skeleton as the full/seal finger phase (Rob:
// consistency). Identical to the beginRecording-scoped _drawHandSkeleton, lifted out so
// beginStillCapture can call it too (it was nested, hence the fast path had no skeleton).
function _drawHandSkeletonShared(videoEl, lm, targetN){
    // F-671 Phase B1: mount-scoped lookup so the WHOLE fast path is zero-document-global on the
    // embedded fast hosts (tribunal / vat-verify). This drawer is FAST-ONLY (called solely from
    // beginStillCapture); the FULL path uses its own nested _drawHandSkeleton, so this cannot affect it.
    const cv=(CTX && CTX.mount) ? CTX.mount.querySelector('#handOverlay') : document.getElementById('handOverlay');
    if(!cv||!videoEl) return;
    if(!cv._ctx) cv._ctx=cv.getContext('2d',{willReadFrequently:false});
    const ctx=cv._ctx;
    if(cv.width!==videoEl.videoWidth){ cv.width=videoEl.videoWidth; cv.height=videoEl.videoHeight; }
    ctx.clearRect(0,0,cv.width,cv.height);
    // F-755: static oval guide only — live skeleton suppressed.
    try { _drawFingerTargetGuide(ctx, cv.width, cv.height, targetN, _guideSide(lm), lm); } catch(_){}
}

// ── F-671 Phase A: shared capture-feedback presentation. Lifted VERBATIM from
//    beginRecording's inner fns, with closure state made explicit via a ctx object. Pure
//    presentation — NO advance-loop state, NO video MediaRecorder, NO Gemini. The full
//    ceremony renders through this now; the fast still-capture adopts it in Phase B.
//    (_drawHandSkeletonShared above was step 1 of this same unification.) ──
const CaptureFeedback = {
    // Phase prompt updater (uses seconds with decimal precision)
    updatePhasePrompt: function(ctx, sec) {
        if (sec < ctx.phraseDuration) {
            // F-563 UX: the active instruction takes over the header in YELLOW so it can't get lost
            // among the other text (Rob — "Say the greeting" was getting lost).
            var _st = ctx.byId('step2Title');
            if (_st) { _st.textContent = (fingerFallback === 'voice') ? 'Say the phrase' : 'Say the greeting'; _st.style.color = '#fbbf24'; }
            // Speaking phase. FINGER mode: GREETING ONLY (numbers stripped) — the numbers are
            // spoken per-digit, each bound to its gesture (SUPP-7). VOICE-ONLY mode skips the
            // digit phase, so the user must speak the FULL phrase (incl numbers) here (codex).
            const _full = challengeData?.phrase || '';
            if (fingerFallback === 'voice') {
                ctx.byId('challengeText').innerHTML = '<span style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;font-family:var(--mono);letter-spacing:1px">SAY THE PHRASE</span>"' + _full + '"';
            } else {
                // R2 (S114): greeting ONLY — strip the trailing digits (the numbers are spoken
                // per-gesture in the digit phase; one recording → backend still gets them). This
                // is the fallback prompt; renderGreeting owns the primary live greeting screen.
                var _greet = vacGreetingText() || _full.replace(/,\s*\d[\d\s,]*$/, '');   // S114: single-source greeting
                ctx.byId('challengeText').innerHTML = '<span style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;font-family:var(--mono);letter-spacing:1px">SAY THE GREETING</span>"' + _greet + '"<span style="font-size:11px;color:var(--text-tertiary);display:block;margin-top:6px">then show each number as you say it, one take</span>';
            }
        } else {
            // Finger phase
            const fingerElapsed = sec - ctx.phraseDuration;
            const digitIndex = Math.min(Math.floor(fingerElapsed / ctx.digitDuration), ctx.digits.length - 1);
            const digit = ctx.digits[digitIndex];
            const step = digitIndex + 1;
            // Show all digits with current highlighted
            var circles = '';
            for (var di = 0; di < ctx.digits.length; di++) {
                if (di < digitIndex) circles += '<span style="display:inline-flex;width:44px;height:44px;border-radius:50%;background:#22c55e;color:white;align-items:center;justify-content:center;font-size:22px;font-weight:700;margin:0 6px;box-shadow:0 0 12px rgba(34,197,94,0.4);">&#10003;</span>';
                else if (di === digitIndex) circles += '<span style="display:inline-flex;width:56px;height:56px;border-radius:50%;border:3px solid var(--purple);background:rgba(124,92,252,0.2);color:white;align-items:center;justify-content:center;font-size:32px;font-weight:700;margin:0 6px;animation:pulse 1s ease infinite">' + ctx.digits[di] + '</span>';
                else circles += '<span style="display:inline-flex;width:44px;height:44px;border-radius:50%;background:var(--surface);color:var(--text-tertiary);align-items:center;justify-content:center;font-size:18px;font-weight:700;margin:0 6px">' + ctx.digits[di] + '</span>';
            }
            // W3.5 refactor: generic prompt — no per-step expected count.
            // User already saw the full sequence in the challenge phrase; per-step
            // count hints created "guess by trial and error" UX when the ticked
            // count didn't match what the user thought they'd shown.
            ctx.byId('challengeText').innerHTML = '<span style="font-size:12px;color:#fbbf24;display:block;margin-bottom:6px;font-family:var(--mono);letter-spacing:1px;font-weight:600;">SHOW FINGERS</span><div style="display:flex;justify-content:center;margin:10px 0">' + circles + '</div><span style="font-size:15px;color:#fff;font-weight:600;">Show next gesture from the phrase</span>';
        }
    },

    // S110: render the persistent above-video digit strip (current digit highlighted).
    // F-563 (2): PROGRESS DOTS only — NO numbers. The current digit's number lives in the big
    // #vacGuided panel (single focus), so the strip never shows the upcoming sequence and the user
    // can't race ahead. done = green ✓, current = filled purple dot, upcoming = empty dot.
    renderDigitStrip: function(ctx, currentIdx) {
        const strip = ctx.byId('digitStrip');
        const row = ctx.byId('digitStripRow');
        if (!strip || !row) return;
        strip.style.display = 'block';
        var html = '';
        for (var i = 0; i < ctx.digits.length; i++) {
            if (i < currentIdx) {
                html += '<span style="display:inline-flex;width:30px;height:30px;border-radius:50%;background:#22c55e;color:#fff;align-items:center;justify-content:center;font-size:16px;font-weight:700;box-shadow:0 0 10px rgba(34,197,94,0.45);">&#10003;</span>';
            } else if (i === currentIdx) {
                html += '<span style="display:inline-flex;width:30px;height:30px;border-radius:50%;border:3px solid var(--purple);background:rgba(124,92,252,0.45);animation:pulse 1s ease infinite;"></span>';
            } else {
                html += '<span style="display:inline-flex;width:30px;height:30px;border-radius:50%;background:var(--surface);border:1px solid var(--border);"></span>';
            }
        }
        row.innerHTML = html;
    },

    // F-563 (2): big guided one-digit panel. Reads the SAME per-digit gate flags the status block
    // uses (gesture done = _qaGestureLatched; voice done = speechReady[i]) — NO gate logic here, pure
    // presentation. The gesture ✓ lights on ANY stable deliberate gesture (content-blind — Gemini
    // validates the count server-side; gating the tick on correctness would re-introduce the
    // misdetection deadlock). Then the voice sub-gate is revealed; its ✓ lights on the spoken number.
    // F-599: adaptive co-occurrence coaching copy. ONE simultaneity phrase ("at the same time")
    // only on the near-miss — the case where timing IS the failure (both said + shown, just too far
    // apart). The voice-only / gesture-only hints name the MISSING action instead of repeating the
    // mantra, so the coaching tells the user what they actually forgot (Q4 = option B).
    coachHintMsg: function(key, N) {
        if (key === 'nearmiss')    return 'Almost — show your fingers and say it at the same time';
        if (key === 'voiceonly')   return 'Now show your ' + N + ' finger' + (N === 1 ? '' : 's') + ' as you say “' + N + '”';
        if (key === 'gestureonly') return 'Say “' + N + '” out loud while you hold up your fingers';
        return '';
    },

    renderGuided: function(ctx, opts) {
        var wrap = ctx.byId('vacGuided');
        if (!wrap) return;
        wrap.style.display = 'block';
        var promptEl = ctx.byId('vacGuidedPrompt');
        var subEl = ctx.byId('vacGuidedSub');
        var gWrap = ctx.byId('vacGuidedGesture');
        var vWrap = ctx.byId('vacGuidedVoice');
        var gLamp = gWrap && gWrap.querySelector('.vac-lamp');
        var vLamp = vWrap && vWrap.querySelector('.vac-lamp');
        function setLamp(lamp, box, state, restIcon) {
            if (!lamp || !box) return;
            if (state === 'done') {
                box.style.opacity = '1';
                lamp.textContent = '✓';
                lamp.style.color = '#fff'; lamp.style.background = '#22c55e';
                lamp.style.borderColor = '#22c55e'; lamp.style.boxShadow = '0 0 14px rgba(34,197,94,0.45)';
                lamp.style.animation = 'none';
            } else if (state === 'active') {
                box.style.opacity = '1';
                lamp.textContent = restIcon;
                lamp.style.color = ''; lamp.style.background = 'rgba(124,92,252,0.18)';
                lamp.style.borderColor = 'var(--purple)'; lamp.style.boxShadow = '0 0 14px rgba(124,92,252,0.35)';
                lamp.style.animation = 'pulse 1s ease infinite';
            } else if (state === 'ready') {
                // Green "in position" — mirrors the face oval flipping solid-green: the hand is in
                // the near-face zone but a stable finger count isn't registering yet (keep the ✋
                // glyph, not the ✓), so it reads as "good spot, hold it" not "complete".
                box.style.opacity = '1';
                lamp.textContent = restIcon;
                lamp.style.color = '#22c55e'; lamp.style.background = 'rgba(34,197,94,0.18)';
                lamp.style.borderColor = '#22c55e'; lamp.style.boxShadow = '0 0 14px rgba(34,197,94,0.45)';
                lamp.style.animation = 'none';
            } else { // pending/dim
                box.style.opacity = '0.4';
                lamp.textContent = restIcon;
                lamp.style.color = ''; lamp.style.background = '';
                lamp.style.borderColor = 'var(--border)'; lamp.style.boxShadow = 'none';
                lamp.style.animation = 'none';
            }
        }
        // F-563 (latch): the camera-free "Say N" cover. ON only during sub-gate 2 (gesture latched,
        // voice not yet given) → one thing per screen. OFF everywhere else (show phase / beat / done)
        // so the camera is back for the next digit's gesture.
        function setSayView(on, word, hint) {
            var sv = ctx.byId('vacSayView');
            if (!sv) return;
            sv.style.display = on ? 'flex' : 'none';
            if (on) {
                var w = ctx.byId('vacSayWord'); if (w) w.textContent = '“' + word + '”';
                var h = ctx.byId('vacSayHint'); if (h) h.textContent = hint || '';
            }
        }
        // F-563 UX: a BIG number during the show-fingers step so the target digit is unmissable.
        function setBigNumber(on, n) {
            var ne = ctx.byId('vacGuidedNumber');
            if (!ne) return;
            // F-AUTH-UX-POLISH (2): never substitute a default. If the digit isn't a real bound
            // value yet (undefined/NaN/empty — e.g. digits[currentDigitIndex] not resolved), hide
            // the big number this frame rather than paint a stray "1". The real digit appears only
            // once it's actually bound.
            var _valid = (typeof n === 'number' && !isNaN(n)) || (typeof n === 'string' && n !== '');
            if (!on || !_valid) { ne.style.display = 'none'; return; }
            ne.style.display = 'block';
            ne.textContent = n;
        }
        if (opts.done) {
            if (promptEl) { promptEl.textContent = 'All captured ✓'; promptEl.style.color = '#22c55e'; }
            if (subEl) subEl.textContent = '';
            setLamp(gLamp, gWrap, 'done', 'G'); setLamp(vLamp, vWrap, 'done', 'V');
            setSayView(false); setBigNumber(false);
            return;
        }
        if (opts.beat) {
            if (promptEl) { promptEl.textContent = '✓  Got it'; promptEl.style.color = '#22c55e'; }
            if (subEl) subEl.textContent = '';
            setLamp(gLamp, gWrap, 'done', 'G'); setLamp(vLamp, vWrap, 'done', 'V');
            setSayView(false); setBigNumber(false);
            return;
        }
        var N = opts.digit;
        // SHOW-AS-YOU-SAY: the camera-free hand-down "Say N" cover is GONE — you keep fingers up
        // while you say it. So there is ONE simultaneous step (not two sub-gates); the lamps are LIVE
        // sensing indicators, and the single combined ✓ is the only accept (handled by opts.beat above).
        setSayView(false);
        if (!opts.voiceOn && opts.rearmed === false) {
            // Speech-off (degraded, no mic) + gesture confirmed but NOT re-armed: advance is BLOCKED
            // (same held pose carried from the last accept). Prompt the re-show (codex). Unchanged.
            if (promptEl) { promptEl.textContent = 'Lower your hand, then show ' + N + ' again'; promptEl.style.color = '#fbbf24'; }
            if (subEl) subEl.textContent = '';
            setLamp(gLamp, gWrap, 'active', 'G');
            setLamp(vLamp, vWrap, 'pending', 'V');
            setBigNumber(true, N);
        } else if (ctx.voiceless) {
            // F-671 Phase B1: gesture-only fast policy (_captureVoice=false) — drop the "say it" half so
            // the copy matches the policy (the fast tier's prior inline copy: "no need to say anything").
            // Hide the voice sub-gate; the gesture lamp logic mirrors the voiced branch below. FULL path
            // never sets ctx.voiceless → this branch is skipped → rendered output stays byte-identical.
            if (promptEl) { promptEl.textContent = 'Show ' + N + ' — hold steady'; promptEl.style.color = 'var(--text-primary)'; }
            setBigNumber(true, N);
            if (vWrap) vWrap.style.display = 'none';
            if (!opts.handNear) {
                if (subEl) subEl.textContent = '✋ Hold your hand up beside your cheek';
                setLamp(gLamp, gWrap, 'pending', 'G');
            } else if (!opts.gestureLive) {
                if (subEl) subEl.textContent = 'Hand detected — hold steady.';
                setLamp(gLamp, gWrap, 'ready', 'G');
            } else {
                if (subEl) subEl.textContent = 'hold steady';
                setLamp(gLamp, gWrap, 'active', 'G');
            }
        } else {
            // The one simultaneous step: show N AND say N together. Camera stays ON, big number shown.
            // Gesture lamp lights while fingers are LIVE (dims if the hand drops → keep it up); voice
            // lamp listens and lights when sustained voice fires. BOTH co-occurring → advance → beat ✓.
            // D-VOICE-GATE-SPEAKER-AGNOSTIC: when energy heard but content not matched, honest coaching
            if (promptEl) {
                if (opts.energyHeard && !opts.voiceDone) {
                    promptEl.textContent = 'Listening — did not catch “' + N + '” yet — say it clearly';
                } else {
                    promptEl.textContent = 'Show ' + N + ' and say “' + N + '” clearly';
                }
                promptEl.style.color = 'var(--text-primary)';
            }
            setBigNumber(true, N);
            setLamp(vLamp, vWrap, (!opts.voiceOn ? 'pending' : (opts.voiceDone ? 'done' : 'active')), 'V');
            if (!opts.handNear) {
                // No hand, or hand outside the in-front-of-face capture zone. THIS is the silent-failure
                // fix: the hand must be near the face (server-side hand_near_face anti-spoof), but the
                // user got NO feedback when it wasn't — the gesture just never registered. Keep the ✋
                // lamp UNLIT and tell them exactly what to do. (The server still enforces the zone.)
                if (subEl) subEl.textContent = '✋ Hold your hand up beside your cheek';
                setLamp(gLamp, gWrap, 'pending', 'G');
            } else if (!opts.gestureLive) {
                // Hand IS in the near-face zone but fingers aren't reading a stable count yet → green ✋
                // ("good spot") + hold-steady guidance, so the user knows the position is right.
                if (subEl) subEl.textContent = 'Hand detected — hold steady.';
                setLamp(gLamp, gWrap, 'ready', 'G');
            } else {
                // Fingers live in-zone — main's existing live-sensing lamp + adaptive co-occurrence coach.
                // F-599: the genuinely-silent-mic help ("a bit louder", >12s) still wins; otherwise show the
                // debounced adaptive coaching for this digit's near-miss state; otherwise the resting sub.
                var _coachSub = opts.voiceHelp ? '' : CaptureFeedback.coachHintMsg(opts.coachKey, N);   // voiceHelp wins → don't even build the coach string
                if (subEl) subEl.textContent = opts.voiceHelp ? 'We can’t hear you — a bit louder' : (_coachSub || 'together, in one go');
                setLamp(gLamp, gWrap, 'active', 'G');
            }
        }
    },

    // Render finger-phase UI (preserves vac-web styling — green ticks, pulsing purple current, gray upcoming)
    renderFingerPhase: function(ctx, hint, currentDigitIndex) {
        if (ctx.digits.length === 0) { ctx.byId('challengeText').textContent = 'Processing\u2026'; return; }
        // S111 #3: per-digit number circles live in #digitStrip ABOVE the video (single source).
        // W3.5 refactor: generic per-step prompt.
        // The detection loop already advances on ANY finger > 0 (line below);
        // server validates the full sequence at the end. Showing the expected
        // count per-step taught users to expect "did it accept my guess?" — the
        // green tick reads as "we got this position, on to the next."
        const hintHtml = hint ? '<div style="color:#fbbf24;font-size:12px;margin-top:6px;font-family:var(--mono);letter-spacing:0.5px">Hold hand closer to camera, fingers spread</div>' : '';
        const remaining = ctx.digits.length - currentDigitIndex;
        const stepLabel = remaining > 1 ? (remaining + ' gestures to go') : (remaining === 1 ? 'last gesture' : 'done');
        // F-563 (2): the strip is now numberless progress DOTS, so this prompt must NAME the current
        // digit itself — otherwise the detector-fallback path (which relies on this text) leaves the
        // user with no per-step number after the one-time intro (codex).
        var _cd = ctx.digits[currentDigitIndex];
        // F-671 Phase B1: gesture-only fast policy drops the "say it" half (copy matches policy). FULL
        // path never sets ctx.voiceless → else branch (the original expression) → byte-identical header.
        var _showNum;
        if (ctx.voiceless) {
            _showNum = (currentDigitIndex < ctx.digits.length) ? ('Show ' + _cd + ' finger' + (_cd === 1 ? '' : 's') + ' — hold steady') : 'Show the next number';
        } else {
            _showNum = (currentDigitIndex < ctx.digits.length) ? ('Show ' + _cd + ' finger' + (_cd === 1 ? '' : 's') + ' AND say “' + _cd + '” clearly — a full beat') : 'Show the next number';
        }
        ctx.byId('challengeText').innerHTML = '<span style="font-size:12px;color:#fbbf24;display:block;margin-bottom:4px;font-family:var(--mono);letter-spacing:1px;font-weight:600;">SHOW FINGERS</span><span style="font-size:15px;color:var(--text-primary);font-weight:600;">' + _showNum + '</span><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' + stepLabel + '</div>' + hintHtml;
    },

    // S110: detect when the hand is too close / clipped by the frame edges so we
    // can prompt the user to pull back. MediaPipe can't count reliably when not all
    // 21 landmarks are visible. We check (a) any landmark near/past an edge and
    // (b) the hand bounding box filling most of the frame. Debounced so the prompt
    // doesn't flicker on momentary edge touches.
    checkHandFraming: function(ctx, lm) {
        const banner = ctx.byId('framingHint');
        if (!lm) { ctx.framingBadFrames = 0; if (banner) banner.style.display = 'none'; return; }
        let minX=1, maxX=0, minY=1, maxY=0;
        for (const p of lm) { if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
        // F-760: tightened — MediaPipe miscounts by ±1 when the hand is too close OR near a frame edge
        // (Rob live: showed 2, read 3, close to camera; correct after moving back). Prompt BEFORE the
        // count degrades, not only when the hand fills/touches the frame.
        // L-2299: zone membership check replaces the old independent tooSmall gate. Coaching fires
        // only when the hand is OUTSIDE the acceptance zone; advice is directionally correct
        // relative to GESTURE_ZONE_SPEC ("beside your cheek", not just "closer").
        const EDGE = 0.08;   // was 0.04 — edge-degraded miscounts start well before touching
        const clipped = (minX < EDGE || maxX > 1-EDGE || minY < EDGE || maxY > 1-EDGE);
        const tooBig  = ((maxX-minX) > 0.72 || (maxY-minY) > 0.78);  // was 0.85/0.9 — too-close miscount starts earlier
        const outsideZone = !_handNearFaceZone(lm);  // replaces tooSmall — zone-aware position coaching
        if (clipped || tooBig || outsideZone) { ctx.framingBadFrames++; } else { ctx.framingBadFrames = 0; }
        if (banner) {
            if (ctx.framingBadFrames >= 4) {  // ~debounced; sustained, not a flicker
                banner.textContent = (clipped || tooBig) ? 'Move your hand back — keep your whole hand in view'
                                                         : 'Hold your hand beside your cheek';
                banner.style.display = 'block';
            } else if (ctx.framingBadFrames === 0) {
                banner.style.display = 'none';
            }
        }
    },
};

// SVG icons (from folioAI — clean, professional, no emoji)
const AV_ICONS = {
    spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 18L18 6M6 6l12 12"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
};

function setAVStatus(check, status, label) {
    const pillMap = { face: 'avPillFace', light: 'avPillLight', mic: 'avPillMic', hand: 'avPillHand' };
    const iconMap = { face: 'avFaceIcon', light: 'avLightIcon', mic: 'avMicIcon', hand: 'avHandIcon' };
    const labelMap = { face: 'avFaceLabel', light: 'avLightLabel', mic: 'avMicLabel', hand: 'avHandLabel' };
    const pill = document.getElementById(pillMap[check]);
    const iconEl = document.getElementById(iconMap[check]);
    const labelEl = document.getElementById(labelMap[check]);
    if (labelEl) labelEl.textContent = label;
    // Set icon and pill class
    if (pill) {
        pill.classList.remove('good', 'warn', 'bad');
        if (status === 'good') { pill.classList.add('good'); iconEl.innerHTML = AV_ICONS.check; iconEl.classList.remove('spinning'); }
        else if (status === 'warn') { pill.classList.add('warn'); iconEl.innerHTML = AV_ICONS.warn; iconEl.classList.remove('spinning'); }
        else if (status === 'bad') { pill.classList.add('bad'); iconEl.innerHTML = AV_ICONS.x; iconEl.classList.remove('spinning'); }
        else { iconEl.innerHTML = AV_ICONS.spinner; iconEl.classList.add('spinning'); }
    }
}

// Progressive mic tips (from folioAI)
let micWaitStart = 0;
function updateMicTips() {
    if (avChecks.mic) {
        // Mic working — update prompt
        const prompt = document.getElementById('avMicPrompt');
        const promptText = document.getElementById('avMicPromptText');
        if (promptText) promptText.textContent = 'Microphone detected';
        // Change icon to green
        const svg = prompt?.querySelector('svg');
        if (svg) svg.setAttribute('stroke', 'var(--success)');
        document.getElementById('avMicTip').style.display = 'none';
        return;
    }
    if (!micWaitStart) micWaitStart = Date.now();
    const waited = (Date.now() - micWaitStart) / 1000;
    const tip = document.getElementById('avMicTip');
    if (waited > 8) {
        const dev = detectDevice();
        const tips = getCameraTips(dev);
        tip.innerHTML = `<span style="color: var(--warning);">Mic not picking up audio?</span> ${tips[0] || 'Check your browser permissions.'}`;
        tip.style.display = 'block';
    } else if (waited > 3) {
        tip.textContent = 'Try speaking louder or clapping';
        tip.style.display = 'block';
    }
}

// S154 fix-on-find (F-1025 spirit, ported from vac-protocol d1656cc): correct code
// running + near-zero pre-flight input for ~6s despite the "speak now" prompt above
// usually means the browser is listening on a DIFFERENT microphone than the one
// being spoken into (Continuity/display/BT mic) — say so explicitly. Complements
// updateMicTips' generic "speak louder"/"check permissions" tips with the specific
// wrong-device hypothesis once the silence is long and sustained enough to point at it.
function _checkMicDeviceWarn(level) {
    if (level >= 2 || avChecks.mic) {
        if (_avSilentFrames) {
            // Clear OUR leftover warning colour (marker-checked so this never clobbers
            // a tip/colour some other code path set) — updateMicTips() keeps managing
            // its own tip content/visibility independently every frame.
            const tip = document.getElementById('avMicTip');
            if (tip && tip.style.color === 'var(--warning)') tip.style.color = '';
        }
        _avSilentFrames = 0;
        return;
    }
    _avSilentFrames++;
    if (_avSilentFrames === 360) { // ~6s at the ~60fps this runs at (audio bar runs every frame)
        const tip = document.getElementById('avMicTip');
        if (tip) {
            tip.innerHTML = 'Very low input. Your browser may be using a different microphone than the one you\'re speaking into — click the camera icon in the address bar, check the Microphone selection, then Refresh camera &amp; mic.';
            tip.style.display = 'block';
            tip.style.color = 'var(--warning)';
        }
        setAVStatus('mic', 'warn', 'Mic: input very low');
    }
}

function updateAVReady() {
    const btn = document.getElementById('btnCamera');
    const guide = document.getElementById('avGuide');
    // FAST still (S120) has NO hand step: only light + mic gate Start (the hand pre-flight
    // is skipped in startAVChecks/runAVFrame). FULL/clip keeps the light, mic, hand gate
    // unchanged (regression-guarded default).
    const _fastStill = (modeConfig().capture.kind === 'still');
    // FAST: the bound digit is read by a single FingerDetector.detect() in beginStillCapture, so
    // the detector must have RESOLVED (ready OR definitively failed) before capture can start —
    // else a cold/slow MediaPipe load yields detected_fingers:null (codex P2). Gate on resolution,
    // NOT on a hand gesture (that was the bug): ready => the finger read works; failed => proceed
    // anyway (no strand; the server face-embedding identity check still gates). Undefined detector
    // => treat as resolved (can't strand on a missing module; finger detection is moot then). The
    // old hand gate guaranteed this implicitly via avChecks.hand requiring a successful detect.
    const _fastDetectorReady = (typeof FingerDetector === 'undefined') || !!FingerDetector.ready || !!FingerDetector.failed;
    // S110 (F-559): guided sequential gate — walk the user through light → mic → hand,
    // one at a time, with explicit instructions. All three must pass before Start.
    if (guide) {
        const _steps = _fastStill ? 2 : 3;   // fast: light+mic; full: +hand
        if (!avChecks.light) {
            guide.textContent = 'Step 1 of ' + _steps + ' — find good lighting so your face is clearly visible';
        } else if (!avChecks.mic) {
            guide.textContent = 'Step 2 of ' + _steps + ' — say a few words to test your microphone';
        } else if (!_fastStill && !avChecks.hand) {
            guide.textContent = 'Step 3 of 3 — hold your hand up beside your cheek, on the marker (you\u2019ll see it tracked)';
        } else if (_fastStill && !_fastDetectorReady) {
            guide.textContent = 'Finishing setup, one moment...';
        } else {
            guide.textContent = 'All set \u2713  You\u2019re ready to verify';
            guide.style.color = 'var(--success)';
            guide.style.borderColor = 'var(--success-border, rgba(63,185,80,0.3))';
            guide.style.background = 'var(--success-bg, rgba(63,185,80,0.10))';
        }
    }
    const allGood = avChecks.light && avChecks.mic && (_fastStill ? _fastDetectorReady : avChecks.hand);
    if (btn.textContent === 'Proceed to Challenge' || btn.textContent.includes('Ready') || btn.textContent.includes('Start') || btn.textContent.includes('Complete the checks')) {
        btn.disabled = !allGood;
        btn.textContent = allGood ? 'Start verification' : 'Complete the checks above';
    }
    // Service-error AUTO-retry: once the (warmed) pre-flight passes, advance to the challenge
    // automatically — preserves the "retrying automatically" flow without the cold-entry race.
    // Auto-proceed only when the challenge is ALSO loaded — requestCamera() clears challengeData
    // before awaiting the fetch, so firing on allGood alone could hit goToChallenge() with a null
    // challenge and trip its blank guard (spurious auto-retry failure on slow networks). This runs
    // every AV frame, so it fires the moment both the checks pass AND the challenge has arrived.
    if (allGood && window.__vacAutoProceedChallenge && !challengeIncomplete()) {
        window.__vacAutoProceedChallenge = false;   // fire once
        window.__vacSkipExplainer = true;            // F-563: silent service-error re-run skips the upfront explainer
        try { vacDebug('autoretry_preflight_passed'); } catch(_) {}
        // DEFER out of this runAVFrame callback: calling goToChallenge() inline lets the current
        // frame re-schedule the AV loop (the requestAnimationFrame at the end of runAVFrame) AFTER
        // goToChallenge's stopAVChecks() runs, leaving the pre-flight loop (incl FingerDetector.detect)
        // running during recording. A 0ms defer runs after this frame, so stopAVChecks cancels the
        // next scheduled frame before it fires (codex).
        setTimeout(function(){ try { goToChallenge(); } catch(_) {} }, 0);
    }
}

function stopAVChecks() {
    if (avCheckFrame) { cancelAnimationFrame(avCheckFrame); avCheckFrame = null; }
    if (avAudioCtx) { avAudioCtx.close().catch(() => {}); avAudioCtx = null; }
    avAnalyser = null;
    avPrevOval = null;
    // Clear the pre-flight hand-zone guide so #faceOval returns and the green ring
    // doesn't linger when the pre-flight stops (leaving step 1 / re-auth).
    try { document.getElementById('cameraBox').classList.remove('show-hand-zone', 'hand-in-zone'); } catch(_) {}
}

function retryAVSetup() {
    // Stop existing checks
    stopAVChecks();
    avChecks = { face: false, light: false, mic: false, hand: false };
    _micLoudFrames = 0;
    _micLevelHistory = [];
    _micRunLevels = [];
    _micRunRatios = [];
    _micRunRmsSamples = [];  // D-VAD-UNITS: ceremony-scale twin of _micRunLevels/_micRunRatios above — kept in lockstep
    _micRunStartT = 0;
    _micLastQualifyT = 0;
    // Stop existing stream
    const video = document.getElementById('videoPreview');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    // Reset pill states
    ['avLightIcon', 'avMicIcon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = AV_ICONS.spinner; el.classList.add('spinning'); }
    });
    setAVStatus('light', 'checking', 'Light');
    setAVStatus('mic', 'checking', 'Mic');
    document.getElementById('avMicPromptText').textContent = 'Speak now to test your microphone';
    document.getElementById('avAudioLevel').style.width = '0%';
    document.getElementById('avAudioPct').textContent = '0%';
    updateAVReady();
    // Re-request camera/mic
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
        .then(stream => {
            video.srcObject = stream;
            video.play();
            startAVChecks();
        })
        .catch(err => {
            console.error('[AV RETRY]', err);
            document.getElementById('avMicTip').textContent = 'Could not access camera/mic. Check browser permissions.';
            document.getElementById('avMicTip').style.display = 'block';
        });
}

// D-GREETING-STATIC-WRONG-NAME / D-INTRO-GREETING-NUMBERS-ASYMMETRY (S114): the SINGLE source
// of truth for the greeting text shown anywhere (intro preview, lead-in, and the live greeting
// screen). It is the greeting clause of the backend challenge — `challengeData.phrase` with the
// trailing OTP digits stripped. The backend rotates the greeting per challenge (Kia ora / Hello /
// Hey there / Good morning / Hi there) and embeds the VERIFIED user's name (the name the frontend
// sent at /challenge = userData().name, the OTP-verified identity). So routing every surface
// through this one function guarantees: same rotating greeting + same real name on the intro and
// the greeting screen, NEVER a hardcoded/static literal. Empty string if there is no challenge yet
// (callers guard: challengeIncomplete blocks recording on a blank phrase).
function vacGreetingText() {
    var p = (challengeData && challengeData.phrase) || '';
    return p.replace(/,\s*\d[\d\s,]*$/, '');   // strip ", <digits>" tail → the rotating greeting + real name
}

// S111: a challenge is recordable only with a phrase AND — in finger mode — non-empty
// digits. A digit-less challenge in finger mode would skip the finger phase and the
// F-561 AND-gate entirely (bypass #1: gate advances without waiting for voice because
// there are no digits to gate), so block it. Voice-only mode (fingerFallback==='voice')
// legitimately carries no client digits, so don't require them there.
function challengeIncomplete() {
    // F-624 Rung 2 (codex P2): the FAST one-digit challenge endpoint returns {fingers:N},
    // NOT the full ceremony's {phrase, digits}. Validate the fast shape (a numeric finger
    // target) so a valid fast challenge isn't mis-flagged blank and bounced to camera retry.
    // FULL mode (capture kind 'clip') falls through to the unchanged phrase/digits guard below.
    if (modeConfig().capture.kind === 'still') {
        return !(challengeData && (typeof challengeData.fingers === 'number' || (challengeData.digits && challengeData.digits.length)));
    }
    if (!challengeData || !challengeData.phrase) return true;
    if (fingerFallback !== 'voice' && !(challengeData.digits && challengeData.digits.length)) return true;
    return false;
}

// STEP 1 → 2: Challenge
function goToChallenge() {
    // S111: never start recording against an incomplete challenge — missing phrase
    // guarantees a Challenge-Response failure, and a digit-less challenge in finger
    // mode skips the AND-gate (bypass #1). Block + offer a retry that re-fetches,
    // instead of silently recording against it.
    if (challengeIncomplete()) {
        try { vacDebug('challenge_blank_blocked', null, { has_challengeData: !!challengeData, has_phrase: !!(challengeData && challengeData.phrase), has_digits: !!(challengeData && challengeData.digits && challengeData.digits.length), finger_fallback: fingerFallback, keys: challengeData ? Object.keys(challengeData).join(',') : null }); } catch(_) {}
        // Tear down the live AV session before offering a retry — otherwise the retry's
        // requestCamera() opens a SECOND mediaStream + AV loop and the first one leaks
        // (stopAVChecks only cancels the most recent global frame/audio context) (codex P2).
        try { stopAVChecks(); } catch(_) {}
        try { if (mediaStream) mediaStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_) {}
        var _cerr = document.getElementById('cameraError');
        if (_cerr) { _cerr.innerHTML = '<div style="color:var(--warning)">Couldn’t load your challenge. Tap “Enable Camera &amp; Microphone” to try again.</div>'; _cerr.style.display = 'block'; }
        var _b = document.getElementById('btnCamera');
        if (_b) { _b.disabled = false; _b.textContent = 'Enable Camera & Microphone'; _b.onclick = requestCamera; }
        return;  // do NOT goToStep(2)/startCountdown with a blank phrase
    }
    stopAVChecks(); // Clean up audio context and animation frame

    // ── FAST-MODE DIRECT PATH (S120 live-test fix, L-2162) ───────────────────────
    // Fast/still re-auth ("show one finger + say the digit") must NOT run the full
    // ceremony's greeting + voice-phrase + warmup + multi-digit explainer choreography.
    // Before this branch, fast fell through into goToChallenge's greeting render and the
    // showChallengeIntro/explainer handoff, which (a) showed the greeting screen fast
    // should skip, and (b) stalled the advance to still-capture so it bounced back to the
    // Re-authorise button ("live capture did not run on this device"). Here fast renders
    // the single bound instruction (fingers + spoken_digit from /face-reauth-challenge) and
    // goes straight to goToStep(2) -> startCountdown(), whose tail already routes
    // capture.kind==='still' to beginStillCapture(). FULL mode is untouched below.
    if (modeConfig().capture.kind === 'still') {
        var _fc = challengeData || {};
        var _digit = (_fc.spoken_digit != null) ? _fc.spoken_digit
                   : (_fc.digits && _fc.digits.length ? _fc.digits[0]
                   : (typeof _fc.fingers === 'number' ? _fc.fingers : null));
        // F-662 follow: the lead-in copy is POLICY-DRIVEN (same _captureVoice derivation as
        // beginStillCapture), not hardcoded no-voice. As of F-654 the fast tier's spoken half is
        // policy-driven — under a bound_digit/voice policy the user MUST be told to say it here too,
        // or the lead-in under-prompts voice and a correct-but-slow user can hit the 6s fail-open.
        // Gesture-only policy keeps the show-only lead-in. (honesty: L-2150 — say what the policy needs)
        var _leadVoice = (reauthPolicyRequired() || []).some(function(m){ return /bound_digit|voice|voiceprint|spoken/i.test(String(m)); });
        var _instr = _fc.bound_instruction
                   || (_digit != null ? ('Quick re-verify \u2014 show your ' + _digit + ' finger' + (_digit === 1 ? '' : 's') + ' beside your cheek and say the number out loud') : ('Quick re-verify \u2014 show the number beside your cheek and say it out loud'));
        var _ctEl = document.getElementById('challengeText');
        if (_ctEl) {
            _ctEl.innerHTML = '<div style="font-size:clamp(16px,4.5vw,20px);font-weight:700;color:var(--text-primary);line-height:1.35;">'
                + (_digit != null ? ('Quick re-verify \u2014 show your <span style="color:var(--purple)">' + _digit + '</span> finger' + (_digit === 1 ? '' : 's') + ' beside your cheek and say the number out loud')
                                  : _instr)
                + '</div><div style="font-size:13px;opacity:0.7;margin-top:8px;">' + (_leadVoice ? 'Keep your face in the oval — when the count starts, show it and say it together.' : 'Keep your face in the oval and hold still — we\u2019ll take one quick photo to confirm it\u2019s you.') + '</div>';
        }
        var _recVidF = document.getElementById('videoPreviewRec');
        if (_recVidF) { _recVidF.srcObject = mediaStream; _recVidF.muted = true; _recVidF.setAttribute('playsinline',''); _recVidF.play().catch(function(){}); }
        // F-626: the fast still-capture must frame the FACE and the FINGERS together. Reuse the SAME
        // wide .hand-zone oval the full-auth gesture step shows (show-hand-zone on #cameraBoxRec)
        // instead of the narrow .face-oval (CSS: .show-hand-zone hides .face-oval, reveals .hand-zone).
        // The narrow face oval led the user to fill it with their face, so raising fingers "in front of
        // your face" occluded the face -> face-api saw 0 faces -> fast_reauth_embedding_failed no_face ->
        // embedding_missing_fail_closed -> fell back to full. PRESENTATION ONLY: the still is drawn from
        // the FULL video frame (drawImage(v,0,0,cw,ch) in beginStillCapture, NOT the oval), so widening
        // the guide changes no captured bytes, no embedding, and no gate — it only helps a genuine attempt
        // frame so its embedding is computable. Mount-scoped (embedded hosts may collide on the id; mirrors
        // beginStillCapture's B1 resolver). No fast-path teardown strips this between here and capture — the
        // show-hand-zone removals all live in the full/clip path (beginRecording/runDetectionLoop/
        // onRecordingComplete/resetGuidedUI); the next ceremony reset clears it.
        try { var _cbrF = (CTX && CTX.mount) ? CTX.mount.querySelector('#cameraBoxRec') : document.getElementById('cameraBoxRec'); if (_cbrF) _cbrF.classList.add('show-hand-zone'); } catch(_) {}
        try { vacDebug('fast_direct_path', null, { has_digit: _digit != null, digit: _digit, has_bound_instruction: !!_fc.bound_instruction }); } catch(_) {}
        goToStep(2);
        // L-2168: bring the user into the process — give a readable beat to absorb the instruction
        // before the countdown starts, instead of snapping immediately. 1.6s ≈ time to read one line.
        setTimeout(function(){ startCountdown(); }, 1600);  // readable lead-in; no greeting, no explainer
        return;  // do NOT run the full greeting/voice/warmup/explainer path below
    }
    // ─────────────────────────────────────────────────────────────────────────────

    const phrase = challengeData?.phrase || `I am ${userData().name}, authorising VAC Protocol`;
    var greetPart = vacGreetingText() || phrase.replace(/,\s*\d[\d\s,]*$/, '');   // R2 + S114: single-source rotating greeting (real name); fallback to the local phrase only if no challenge
    // Voice-aware: in voice-only fallback there is NO finger phase, so the user must speak the
    // FULL phrase (incl numbers) — show it directly (mirrors setFingerFallback). Finger mode
    // shows the greeting + the finger instructions. Without this, a voice-only RETRY (routed
    // through goToChallenge) would prompt only the greeting and fail challenge-response (codex).
    if (fingerFallback === 'voice') {
        document.getElementById('challengeText').innerHTML = '<span style="font-size:15px">Say: "' + phrase + '"</span><br><span style="font-size:12px;color:var(--warning);margin-top:8px;display:inline-block">Voice-only mode (reduced trust score)</span>';
    } else if (skipGreeting) {
        // F-648 (was F-635-LIGHTER): the SEAL-GATE name-less re-auth — the user says ONLY the
        // numbers (the fresh per-session random digits = the anti-replay anchor). No greeting and
        // NO "I am {name}": the backend phrase is digits-only so the scorer CORE is the digits and a
        // digits-only read scores 1.0 (config.py 0.80). A copy-only change that left the name in the
        // backend phrase would score n/(n+1) < 0.80 and FAIL (L-2170) — this stays coherent with the
        // backend nameless phrase + the live prompt. The spoken name was never a real identity proof
        // (a known string); identity to the owner is the seal/session layer's job. The digits come
        // from challengeData.digits (not phrase-parsing) so this is robust to the phrase being bare digits.
        var _nums = ((challengeData && challengeData.digits) || []).join(' ');
        document.getElementById('challengeText').innerHTML = '<span style="font-size:15px;color:var(--text-primary);font-weight:600">Say your numbers: "' + _nums + '"</span><br><span style="font-size:13px;opacity:0.7;margin-top:8px;display:inline-block">then show each number as you say it · no name needed, you verified moments ago</span>';
    } else {
        // R2 (S114): greeting ONLY (greetPart strips the trailing digits). Pre-countdown lead-in
        // (overwritten by "Get ready…" in startCountdown); renderGreeting owns the live prompt. The
        // numbers are previewed once on the intro screen and spoken per-gesture in the digit phase —
        // not shown here, so the user isn't tempted to say them during the greeting.
        document.getElementById('challengeText').innerHTML = '<span style="font-size:15px">Say: "' + greetPart + '"</span><br><span style="font-size:13px;opacity:0.7;margin-top:8px;display:inline-block">then show each number as you say it, one take</span>';
    }
    // Accessibility fallback link
    if (!document.getElementById('fingerFallback')) {
        const fb = document.createElement('div');
        fb.id = 'fingerFallback';
        fb.style.cssText = 'text-align:center;margin-top:8px';
        fb.innerHTML = '<button onclick="setFingerFallback()" style="background:none;border:none;color:var(--text-secondary);font-family:var(--mono);font-size:12px;cursor:pointer;text-decoration:underline;padding:8px 4px">Cannot show fingers? Voice-only mode</button>';
        document.getElementById('challengeText').parentElement.appendChild(fb);
    }
    const recVid = document.getElementById('videoPreviewRec');
    recVid.srcObject = mediaStream;
    recVid.muted = true;
    recVid.setAttribute('playsinline', '');
    recVid.play().catch(() => {});
    // ── TOGGLE-GATED warm-up (S110): only runs with ?warmup=1 in the URL. Aims to
    // fix the first-finger cold-start lag by warming MediaPipe during the speak phase
    // on voice onset. Uses a SHARED monotonic timestamp (window.__vacMpTs) that the
    // real detection loop also reads, so warm-up calls can never violate detectForVideo's
    // strictly-increasing-timestamp rule. Heavily logged so the console shows exactly
    // what happens. Default (no flag) = untouched known-good behaviour.
    try {
        if (new URLSearchParams(window.location.search).get('warmup') === '1') {
            window.__vacMpTs = window.__vacMpTs || 0;
            console.log('[WARMUP] toggle ON — voice-triggered detector warm-up active');
            const warmCtx = new AudioContext();
            if (warmCtx.state === 'suspended') warmCtx.resume();
            const wa = warmCtx.createAnalyser(); wa.fftSize = 256;
            warmCtx.createMediaStreamSource(mediaStream.clone()).connect(wa);
            const wbuf = new Uint8Array(wa.fftSize);
            let warmCount = 0; const WARM_MAX = 5;
            const deadline = performance.now() + 12000;
            let wRAF = null;
            function stopWarm(why){ console.log('[WARMUP] stopping —', why, '(', warmCount, 'warm calls fired )'); try{warmCtx.close();}catch(_){} if(wRAF) cancelAnimationFrame(wRAF); }
            (function watchVoice(){
                if (warmCount >= WARM_MAX) { stopWarm('reached WARM_MAX'); return; }
                if (performance.now() > deadline) { stopWarm('12s deadline'); return; }
                wa.getByteTimeDomainData(wbuf);
                let mx=0; for(let i=0;i<wbuf.length;i++){const d=Math.abs(wbuf[i]-128); if(d>mx)mx=d;}
                const level = (mx/128)*100;
                if (level > 8) {
                    window.__vacMpTs += 1;  // shared monotonic clock — always ahead of real loop's next read
                    const t0 = performance.now();
                    FingerDetector.warmOnce(recVid, window.__vacMpTs);
                    console.log('[WARMUP] voice level', level.toFixed(0), '→ warmOnce #' + (warmCount+1), 'ts=' + window.__vacMpTs, '(' + (performance.now()-t0).toFixed(0) + 'ms)');
                    warmCount++;
                }
                wRAF = requestAnimationFrame(watchVoice);
            })();
        }
    } catch (e) { console.warn('[WARMUP] setup error (non-fatal):', e); }
    goToStep(2);
    // F-563 (1): show the upfront explainer (big text + one-time sequence preview), THEN start the
    // countdown on "I'm ready". Skip it for the service-error AUTO-PROCEED (silent re-run — the user
    // has already seen it). The skip flag is used instead of a positional param because goToChallenge
    // is also wired as btnCamera.onclick (which would pass a truthy MouseEvent as the first arg).
    if (window.__vacSkipExplainer) {
        window.__vacSkipExplainer = false;
        setTimeout(() => startCountdown(), 800);
    } else {
        showChallengeIntro();
    }
}

// F-563 (1): populate the intro with a ONE-TIME preview of the full digit sequence (familiarity),
// then reveal one digit at a time during the challenge. Voice-only mode has no finger phase, so the
// intro is finger-mode only; voice-only goes straight to the countdown.
function showChallengeIntro() {
    var overlay = document.getElementById('challengeIntro');
    var digits = (fingerFallback === 'voice') ? [] : (challengeData && challengeData.digits || []);
    if (!overlay || digits.length === 0) { setTimeout(() => startCountdown(), 800); return; }
    var row = document.getElementById('challengeIntroDigits');
    if (row) {
        row.innerHTML = digits.map(function(d) {
            return '<span style="display:inline-flex;width:clamp(48px,13vw,60px);height:clamp(48px,13vw,60px);border-radius:50%;border:2px solid var(--purple);background:rgba(124,92,252,0.18);color:var(--text-primary);align-items:center;justify-content:center;font-size:clamp(26px,7vw,34px);font-weight:800;">' + d + '</span>';
        }).join('');
    }
    // R3 (S114): dynamic count in the intro body (not hardcoded "three"), singular/plural-aware.
    var _cnt = document.getElementById('challengeIntroCount');
    if (_cnt) _cnt.textContent = digits.length + (digits.length === 1 ? ' number' : ' numbers');
    // D-INTRO-GREETING-NUMBERS-ASYMMETRY (S114): preview the ACTUAL greeting from the SAME source the
    // greeting screen uses (rotating greeting + verified name). textContent = no markup-injection risk.
    var _greetEl = document.getElementById('challengeIntroGreeting');
    // F-654: the INTRO copy must derive from the SAME policy as the flow — when COPS/PID
    // drops the voice phase (seal re-auth), the intro must NOT say "First a greeting" /
    // "Say a short greeting", because the flow goes straight to digits+fingers. Rewrite the
    // headline + body from the policy so the intro can never promise a greeting the flow
    // doesn't have (the drift Rob caught). Non-seal (voice present) keeps the static copy.
    var _noVoice = false;
    try { _noVoice = reauthPolicyDropsVoicePhrase(); } catch(_) {}
    var _hEl = document.getElementById('challengeIntroHeadline');
    var _bEl = document.getElementById('challengeIntroBody');
    if (_noVoice) {
        var _n = digits.length;
        if (_hEl) _hEl.innerHTML = 'Show your numbers,<br>one at a time.';
        // F-762 / F-654: greeting-less seal flow — NO greeting mention (the flow goes straight to
        // digits+fingers). Body previews the numbers step only, matching the headline.
        if (_bEl) _bEl.innerHTML = 'On the next step, we\u2019ll show you <strong style="color:var(--text-primary);">' + _n + (_n === 1 ? ' number' : ' numbers') + '</strong> <strong style="color:var(--text-primary);">one at a time</strong> — for each, <strong style="color:var(--text-primary);">show that many fingers AND say it together</strong>.<br>No need to memorise them — we\u2019ll guide you through each one with a <span style="color:#22c55e;font-weight:700;">\u2713</span> before the next.';
    }
    if (_greetEl) {
        var _g;
        if (skipGreeting || _noVoice) {
            // F-648 / F-654: name-less seal re-auth — there is no greeting/identity lead-in to
            // preview. The numbers are previewed as the digit pips above; the user says only the numbers.
            _g = '';
        } else {
            _g = vacGreetingText() || '';
        }
        _greetEl.textContent = _g ? ('“' + _g + '”') : '';
    }
    overlay.style.display = 'block';
    try { vacDebug('challenge_intro_shown', null, { digits_count: digits.length, has_greeting: !!vacGreetingText() }); } catch(_) {}
}

function dismissChallengeIntro() {
    var overlay = document.getElementById('challengeIntro');
    if (overlay) overlay.style.display = 'none';
    try { vacDebug('challenge_intro_dismissed'); } catch(_) {}
    startCountdown();
}

function setFingerFallback() {
    if (fingerFallback === 'none') {
        fingerFallback = 'voice';
        const fb = document.getElementById('fingerFallback');
        if (fb) fb.querySelector('button').textContent = 'Switch back to finger mode';
        const phrase = challengeData?.phrase || '';
        document.getElementById('challengeText').innerHTML = '"' + phrase + '"<br><span style="font-size:12px;color:var(--warning);margin-top:6px;display:inline-block">Voice-only mode (reduced trust score)</span>';
    } else {
        fingerFallback = 'none';
        const fb = document.getElementById('fingerFallback');
        if (fb) fb.querySelector('button').textContent = "Cannot show fingers? Voice-only mode";
        const phrase = challengeData?.phrase || '';
        // R2 (S114): back in finger mode → single-source rotating greeting (real name); numbers come per-gesture.
        const greetPart = vacGreetingText() || phrase.replace(/,\s*\d[\d\s,]*$/, '');
        document.getElementById('challengeText').innerHTML = '"' + greetPart + '"<br><span style="font-size:12px;opacity:0.5;margin-top:6px;display:inline-block">then show each number as you say it, one take</span>';
    }
}

// STEP 2: Countdown then record
function startCountdown() {
    const timerEl = document.getElementById('countdownTimer');
    const ringFill = document.getElementById('countdownRingFill');
    const circumference = 2 * Math.PI * 39;
    let count = SPEED_CONFIG[challengeSpeed].countdown;
    timerEl.textContent = count;
    ringFill.style.strokeDashoffset = 0;
    // F-563 (Finding 1): during the lead-in countdown the system is NOT yet listening/recording.
    // goToChallenge() left the greeting ("Say: …") in #challengeText, which tempted the user to
    // start speaking before beginRecording. Show a neutral "Get ready…" — the greeting prompt
    // appears ONLY when we're actually listening (renderGreeting, at beginRecording).
    _setPhase(_PHASE.COUNTDOWN);   // L-2246: register COUNTDOWN before any DOM write below
    try {
        var _ct = document.getElementById('challengeText');
        if (_ct) _ct.innerHTML = '<div style="font-size:clamp(16px,4.5vw,20px);font-weight:700;color:var(--text-secondary);">Get ready…</div>';
        var _t2 = document.getElementById('step2Title');
        if (_t2) { _t2.textContent = 'Get ready'; _t2.style.color = ''; }
    } catch(_) {}

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            timerEl.textContent = count;
            ringFill.style.strokeDashoffset = circumference * ((SPEED_CONFIG[challengeSpeed].countdown - count) / SPEED_CONFIG[challengeSpeed].countdown);
        } else {
            clearInterval(interval);
            timerEl.textContent = '●';
            ringFill.classList.add('recording');
            ringFill.style.strokeDashoffset = 0;
            // F-624 Rung 2: capture kind is mode-driven. FULL (default) records a full A/V
            // clip (beginRecording); FAST grabs a single still + finger count (beginStillCapture).
            if (modeConfig().capture.kind === 'still') { beginStillCapture(); }
            else { beginRecording(); }
        }
    }, 1000);
}

// S154 GATE DIAGNOSTICS (L-2173: one runtime datum beats rounds of code-reading).
// A small fixed line reporting the last gate event with its numbers, so a missed
// digit tells us duration/peak/threshold instead of requiring another guess cycle.
function _vadDiag(msg){
    try {
        var el = document.getElementById('vacVadDiag');
        if (!el) {
            el = document.createElement('div');
            el.id = 'vacVadDiag';
            el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:10px/1.4 ui-monospace,monospace;color:#9498A8;background:rgba(10,15,26,0.85);padding:3px 8px;border-radius:4px;pointer-events:none;max-width:92vw;';
            document.body.appendChild(el);
        }
        el.textContent = msg;
    } catch(_){}
}

// ── D-VOICE-GATE-SPEAKER-AGNOSTIC: content-gated voice progression ───────────
// SECURITY FIX (task-voice-content-gate): Rob's daughter singing behind a closed
// door drove RMS past the gold line and advanced the ceremony while Rob was silent.
// Root cause: progression was energy/RMS-only — speaker- and content-agnostic.
// Fix: gate progression on CONTENT — transcript must match the expected digit or
// phrase tokens. Energy/RMS is DEMOTED to mic-health indicator only (never advances
// the ceremony). Non-matching audio segments are DISCARDED, never stored (privacy).
//
// Numeral matching (F-823): same algorithm as engine.py normalize_words — word or
// digit form, language-tolerant so "two" and "2" both match digit 2.

const _CONTENT_DIGIT_MAP = {
    'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,
    'six':6,'seven':7,'eight':8,'nine':9,
    // task-653: iOS/ASR transcription homophones — whitelist only, no fuzzy matching
    // (security: D-VOICE-GATE). Extend BOTH this map and engine.py normalize_words identically.
    'for':4,'fore':4,                       // four → 4
    'won':1,'juan':1,                        // one → 1 (juan: Spanish/multilingual ASR)
    'to':2,'too':2,'tu':2,                   // two → 2 (tu: Spanish/multilingual ASR)
    'tree':3,'free':3,                       // three → 3 (tree: Irish-English, free: /θ/-merger)
    'fife':5,                                // five → 5
    'ate':8,                                 // eight → 8
    'oh':0,'o':0,                            // zero → 0 (single vowel phoneme)
    'niner':9                                // nine → 9 (aviation/NATO)
};

// Homophones that are also high-frequency English function words (prepositions,
// infinitive marker, articles). These only match when the transcript is clearly
// digit-focused: <= 3 total words OR >= 40% of words map to a digit.
// Without this guard "happy birthday to you" (one digit word out of four) would
// advance the ceremony on the digit 2 challenge — Rob's daughter scenario.
// Canonical digit words (zero, one, two … nine) are unambiguous and always match.
var _CONTENT_AMBIGUOUS_HOMOPHONES = new Set(['to','too','for','fore','won','o','oh']);

function _contentNormWord(w) {
    w = (w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (Object.prototype.hasOwnProperty.call(_CONTENT_DIGIT_MAP, w)) return _CONTENT_DIGIT_MAP[w];
    if (/^\d$/.test(w)) return parseInt(w, 10);
    return null;
}

// Returns true if transcript contains the expected digit as a word or numeral.
// Non-matching transcripts are DISCARDED — never stored (privacy rule).
function _contentTranscriptHasDigit(transcript, digit) {
    if (transcript == null || digit == null) return false;
    var words = String(transcript).toLowerCase().split(/[\s,.'!?;:]+/).filter(Boolean);
    if (!words.length) return false;
    var digitWordCount = 0, matchedDirect = false, matchedAmbiguous = false;
    for (var wi = 0; wi < words.length; wi++) {
        var w = words[wi];
        // _contentNormWord handles word form ("three"→3) and single-digit numeral ("3"→3).
        // Multi-digit strings (e.g. "321") are rejected — substring match would let ambient
        // speech like "thirteen" (→"13") bypass the gate for digit 3. (security: D-VOICE-GATE)
        var mapped = _contentNormWord(w);
        if (mapped !== null) {
            digitWordCount++;
            if (mapped === digit) {
                if (_CONTENT_AMBIGUOUS_HOMOPHONES.has(w)) matchedAmbiguous = true;
                else matchedDirect = true;
            }
        }
    }
    if (matchedDirect) return true;
    // Ambiguous homophones only accepted in focused transcripts (short or digit-dense).
    // This prevents common English sentences from triggering on incidental homophone matches.
    if (matchedAmbiguous) return words.length <= 3 || (digitWordCount / words.length) >= 0.4;
    return false;
}

// Returns true if transcript contains enough phrase tokens (greeting content gate).
// Requires at least half the content tokens to match (language-tolerant partial match).
function _contentTranscriptMatchesPhrase(transcript, phraseTokens) {
    if (!transcript || !phraseTokens || !phraseTokens.length) return false;
    var norm = String(transcript).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    var words = norm.split(/\s+/).filter(Boolean);
    var matchCount = 0;
    for (var ti = 0; ti < phraseTokens.length; ti++) {
        if (words.indexOf(String(phraseTokens[ti]).toLowerCase()) >= 0) matchCount++;
    }
    return matchCount >= Math.ceil(phraseTokens.length * 0.5);
}

// True if the browser supports SpeechRecognition (evaluated once at module load).
// False on Firefox — falls back to energy VAD gate for progression (degraded mode).
var _contentGateAvail = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// Starts a SpeechRecognition content gate for one digit. Returns {stop()} or null.
// Privacy note: SpeechRecognition may stream audio to the browser vendor's STT service.
// This is intentional — content-match security outweighs the prior energy-only approach;
// the challenge digits are already transcribed server-side via Deepgram anyway.
// Non-matching interim transcripts are checked in memory and immediately discarded.
// onFatal: called when a fatal STT error (not-allowed, audio-capture) kills the gate.
// The caller uses it to null out the outer gate handle so _refreshContentGate starts a fresh gate
// or falls back to energy-VAD instead of stalling the ceremony with a dead-but-non-null handle.
// onNoMatch (task-653): called when non-matching transcripts arrive for >=NO_MATCH_FALLBACK_MS
// while vadProbe() returns true — provisional client pass; server bound-digit gate is authority.
// vadProbe: optional function() → boolean; if absent, VAD check is skipped (pure transcript timing).
const NO_MATCH_FALLBACK_MS = 4000;  // task-653: >=4s of non-match transcripts + VAD voice → provisional
function _startDigitContentGate(expectedDigit, onMatch, onFatal, onNoMatch, vadProbe) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var stopped = false, matched = false, rec;
    var _noMatchVoiceAt = 0;  // task-653: perf.now() when first non-matching transcript arrived with VAD active
    try {
        rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = 'en-US';
    } catch(_) { return null; }
    rec.onresult = function(evt) {
        if (matched || stopped) return;
        for (var ri = evt.resultIndex; ri < evt.results.length; ri++) {
            var t = evt.results[ri][0].transcript;
            if (_contentTranscriptHasDigit(t, expectedDigit)) {
                matched = true;
                stopped = true;              // prevent onend restart
                try { rec.abort(); } catch(_) {}  // stop immediately; no overlap with next digit
                try { onMatch(t); } catch(_) {}
                return;
            }
            // Non-matching transcript — discarded here, never stored (privacy rule).
            // task-653 no-match fallback: transcripts arriving but never matching, with VAD
            // confirming sustained voice for >=NO_MATCH_FALLBACK_MS → provisional client pass.
            // Server bound-digit gate (Deepgram + Gemini) remains the security authority.
            if (onNoMatch && (typeof vadProbe !== 'function' || vadProbe())) {
                if (_noMatchVoiceAt === 0) _noMatchVoiceAt = performance.now();
                else if (performance.now() - _noMatchVoiceAt >= NO_MATCH_FALLBACK_MS) {
                    matched = true; stopped = true;
                    try { rec.abort(); } catch(_) {}
                    try { onNoMatch(t); } catch(_) {}
                    return;
                }
            } else {
                _noMatchVoiceAt = 0;  // reset timer when VAD is not active — ensures >=4s of SUSTAINED voice
            }
        }
    };
    rec.onerror = function(evt) {
        // Fatal errors don't self-recover — mark stopped so onend doesn't restart.
        // Non-fatal (no-speech, aborted) are transient; let onend handle restart.
        var e = evt && evt.error;
        var fatal = (e === 'not-allowed' || e === 'audio-capture' || e === 'network' || e === 'service-not-allowed');
        if (fatal) { stopped = true; if (onFatal) { try { onFatal(); } catch(_) {} } }
        if (!stopped) { try { rec.abort(); } catch(_) {} }
    };
    rec.onend = function() {
        // Auto-restart on natural end (recognition stops after ~1min of silence)
        if (!stopped && !matched) { try { rec.start(); } catch(_) {} }
    };
    // Dead-man switch: if rec.start() throws, stopped stays true so onend never restarts
    // the zombie recognizer (which would hold the mic stream indefinitely). Only flip false
    // after a successful start so the onend auto-restart path is safe.
    stopped = true;
    try { rec.start(); stopped = false; } catch(_) { return null; }
    return { stop: function() { stopped = true; try { rec.abort(); } catch(_) {} } };
}

// Starts a content gate for the greeting phrase. phraseTokens = key content words.
function _startPhraseContentGate(phraseTokens, onMatch, onFatal) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var stopped = false, matched = false, rec;
    try {
        rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = 'en-US';
    } catch(_) { return null; }
    rec.onresult = function(evt) {
        if (matched || stopped) return;
        for (var ri = evt.resultIndex; ri < evt.results.length; ri++) {
            var t = evt.results[ri][0].transcript;
            if (_contentTranscriptMatchesPhrase(t, phraseTokens)) {
                matched = true;
                stopped = true;
                try { rec.abort(); } catch(_) {}
                try { onMatch(t); } catch(_) {}
                return;
            }
            // Non-matching transcript — discarded here, never stored (privacy rule)
        }
    };
    rec.onerror = function(evt) {
        var e = evt && evt.error;
        var fatal = (e === 'not-allowed' || e === 'audio-capture' || e === 'network' || e === 'service-not-allowed');
        if (fatal) {
            // S157: a mid-flight fatal (esp. 'network' — Chrome STT streams to
            // Google; flaky WiFi kills it) previously left the gate a silent corpse:
            // stopped forever, no fallback, every later utterance ignored. Route it
            // to onFatal so the caller flips to the energy fallback the Firefox
            // path already uses; the server still judges content from the recording.
            stopped = true;
            try { if (onFatal) onFatal(e); } catch(_) {}
            return;
        }
        if (!stopped) { try { rec.abort(); } catch(_) {} }
    };
    rec.onend = function() {
        if (!stopped && !matched) {
            try { rec.start(); }
            catch(_) { stopped = true; try { if (onFatal) onFatal('restart-failed'); } catch(__) {} }
        }
    };
    stopped = true;
    try { rec.start(); stopped = false; } catch(_) { return null; }
    return { stop: function() { stopped = true; try { rec.abort(); } catch(_) {} } };
}

function beginRecording() {
    _legitStopScheduled = false; // F-720: arm the guard; only finishFingerPhase may disarm it
    try { vacDebug('begin_recording_called'); } catch(_) {}
    try { resetGuidedUI(); } catch(_) {}  // F-563: clear any stale guided-flow DOM before a new session (belt-and-suspenders; reload covers re-auth)
    try { FingerDetector.reset(); } catch(_) {}  // S110: clear slow-frame latch so retry re-engages detection
    document.getElementById('recIndicator').style.display = 'flex';
    // Speed toggle was removed — guard against null (it may or may not be present)
    const _speedToggle = document.getElementById('speedToggle');
    if (_speedToggle) _speedToggle.style.display = 'none';
    document.getElementById('audioLevel').style.display = 'flex';
    document.getElementById('cameraBoxRec').classList.add('recording');
    document.getElementById('timerLabel').textContent = 'Recording';

    // Start audio level monitoring
    startAudioMonitor();

    recordedChunks = [];

    // MediaRecorder mimeType fallback chain (Chrome → Safari → default)
    const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ];
    let selectedMime = '';
    for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
            selectedMime = mime;
            break;
        }
    }

    console.log('[Recording] Audio tracks before MediaRecorder start:', mediaStream.getAudioTracks().length, mediaStream.getAudioTracks().map(t => t.label + ' enabled=' + t.enabled + ' muted=' + t.muted));
    // S110: cap bitrate so the recorded video stays small enough for Gemini's
    // inline-request size limit. Uncapped 1280x960 webm can exceed ~20MB on
    // longer (3-digit) recordings → base64 inline send to Gemini intermittently
    // fails as "service unavailable". 1.5Mbps video + 64kbps audio keeps a
    // ~10s clip well under the cap while staying clear enough for liveness/lip-sync.
    const options = selectedMime
        ? { mimeType: selectedMime, videoBitsPerSecond: 1500000, audioBitsPerSecond: 64000 }
        : { videoBitsPerSecond: 1500000, audioBitsPerSecond: 64000 };
    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    // F-720: fail-closed guard. onstop fires legitimately ONLY via finishFingerPhase's
    // 1500ms-delayed stop. Any earlier stop means a stream/track death — abort, never submit.
    mediaRecorder.onstop = function() {
        try { vacDebug('recorder_stopped'); } catch(_) {}
        var _elapsed = performance.now() - _recorderStartMs;
        if (!_legitStopScheduled || _elapsed < 2000) {
            var _vt = 'unknown', _at = 'unknown';
            try { _vt = (mediaStream && mediaStream.getVideoTracks()[0]) ? mediaStream.getVideoTracks()[0].readyState : 'none'; } catch(_) {}
            try { _at = (mediaStream && mediaStream.getAudioTracks()[0]) ? mediaStream.getAudioTracks()[0].readyState : 'none'; } catch(_) {}
            try { vacDebug('capture_died', null, { elapsed_ms: Math.round(_elapsed), video_track_state: _vt, audio_track_state: _at }); } catch(_) {}
            _showCaptureDiedRecovery();
            return;
        }
        onRecordingComplete();
    };
    _recorderStartMs = performance.now();
    mediaRecorder.start();
    try { vacDebug('recorder_started'); } catch(_) {}  // F-560: anchor the QA overlay clock (t0) at the real recorder start

    // S-116 Track-2 (Didit passive liveness): grab ONE still frame from the LIVE
    // capture buffer at a known offset into the recording. It rides the EXISTING
    // verify request (see runRealVerification) — no second camera open, no extra
    // HTTP call. We sample ~800ms in: the speak phase (the phrase timer below) is
    // live for every speed (phrase >= 2s), the camera has long since settled (the
    // preview has been streaming since before the countdown), and the user is
    // face-forward reading the phrase prompt — a clean, stable frame for liveness.
    // Best-effort: any failure leaves
    // face_still_b64 empty so the backend fail-closes Didit (Gemini still runs).
    const __recStartMs = performance.now();
    window.__vacFaceStillB64 = '';
    window.__vacFaceStillTsMs = 0;
    const FACE_STILL_DELAY_MS = 800;
    setTimeout(function captureBoundStill() {
        try {
            // Only sample while genuinely recording (user may have aborted).
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
            const v = document.getElementById('videoPreviewRec');
            if (!v || !v.videoWidth || !v.videoHeight) return; // frame not ready → leave empty
            // Downscale to <=640px longest edge to stay well under the request budget.
            const longest = Math.max(v.videoWidth, v.videoHeight);
            const scale = longest > 640 ? 640 / longest : 1;
            const cw = Math.max(1, Math.round(v.videoWidth * scale));
            const ch = Math.max(1, Math.round(v.videoHeight * scale));
            // drawImage captures the RAW (un-mirrored) frame, same orientation as the
            // face_embedding capture — the CSS scaleX(-1) is display-only.
            const c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(v, 0, 0, cw, ch);
            const dataUrl = c.toDataURL('image/jpeg', 0.9);
            const comma = dataUrl.indexOf(',');
            if (comma === -1) return; // malformed → leave empty
            window.__vacFaceStillB64 = dataUrl.slice(comma + 1); // strip "data:image/jpeg;base64,"
            window.__vacFaceStillTsMs = Math.round(performance.now() - __recStartMs);
            console.log('[VAC] Bound still captured @' + window.__vacFaceStillTsMs + 'ms (' + cw + 'x' + ch + ', ~' + Math.round(window.__vacFaceStillB64.length / 1024) + 'KB b64)');
        } catch (e) {
            // Never fabricate — empty still tells the backend to fail-close Didit.
            window.__vacFaceStillB64 = '';
            window.__vacFaceStillTsMs = 0;
            console.warn('[VAC] Bound still capture failed (non-fatal):', (e && e.message) || e);
        }
    }, FACE_STILL_DELAY_MS);

    // Show combined capture info
    document.getElementById('combinedCaptureInfo').style.display = 'block';

    // Simultaneous: say greeting (4s), then say+show each digit (2s each)
    const digits = challengeData?.digits || [];
    // F-654 STEP 2: PHRASE_DURATION is the SINGLE governor of the spoken-phrase phase —
    // the recording timeline, the "read window over?" checks (sec < PHRASE_DURATION), and
    // the finger-phase start (sec - PHRASE_DURATION) all key off it. When COPS/PID policy
    // drops the voice modality (low/medium-risk re-auth), set it to 0 so the phrase phase
    // has ZERO duration — the flow starts the fingers + per-gesture-digit phase immediately.
    // The phase is structurally absent, not flag-skipped. Full auth (no policy / voice
    // present) keeps the normal read window → byte-identical. (Digits still spoken per
    // gesture, so the backend whole-transcript match still receives them.)
    const _dropVoicePhrase = reauthPolicyDropsVoicePhrase();
    const PHRASE_DURATION = _dropVoicePhrase ? 0 : SPEED_CONFIG[challengeSpeed].phrase;
    const DIGIT_DURATION = SPEED_CONFIG[challengeSpeed].digit;
    const BUFFER = 0;
    const totalDuration = PHRASE_DURATION + (digits.length * DIGIT_DURATION) + BUFFER;
    const totalSeconds = Math.ceil(totalDuration);

    let elapsedMs = 0;
    const TICK_MS = 200; // Update 5x per second for smooth sub-second timing
    const timerEl = document.getElementById('countdownTimer');
    const ringFill = document.getElementById('countdownRingFill');
    const challengeEl = document.getElementById('challengeText');
    const circumference = 2 * Math.PI * 39;
    timerEl.textContent = totalSeconds;
    ringFill.classList.add('recording');
    ringFill.style.strokeDashoffset = 0;

    // F-671 Phase A: capture-feedback state made explicit so the presentation fns live at
    // module level (CaptureFeedback.*) and can be shared with the fast still path (Phase B).
    // FULL: byId = document.getElementById → byte-identical on auth.html. NO advance-loop
    // state, NO recorder/Gemini ref enters ctx (the no-clip invariant, enforced by shape).
    const ctx = {
        byId: function(id){ return document.getElementById(id); },
        digits: digits,
        phraseDuration: PHRASE_DURATION,
        digitDuration: DIGIT_DURATION,
        framingBadFrames: 0,
    };
    if (_dropVoicePhrase) {
        // F-654: COPS/PID policy dropped the voice-phrase modality (same-session SEAL re-auth —
        // full strength, no greeting). Do NOT render the spoken-phrase screen at all: open the
        // recording DIRECTLY in the finger/digit phase. renderGreeting() paints the audio-only
        // phrase screen (camera + mic, no hand skeleton) — calling it even once shows the "silly"
        // up-front audio phase before the finger phase. With PHRASE_DURATION=0, updatePhasePrompt(0)
        // renders the FINGER branch (sec < 0 is false), so the user lands straight on the
        // skeleton+digit phase. The digits are still spoken per gesture there, so liveness/voice is
        // captured — just not as a separate phase.
        _setPhase(_PHASE.DIGIT);   // L-2246: no greeting phase for policy-drop path
        try { var _stNV = document.getElementById('step2Title'); if (_stNV) { _stNV.textContent = 'Quick re-confirm'; _stNV.style.color = ''; } } catch(_) {}
        try { CaptureFeedback.updatePhasePrompt(ctx, 0); } catch(_) {}
    } else if (skipGreeting) {
        // F-648: the phrase phase RUNS (the user still SPEAKS — they say the NUMBERS, the per-session
        // anti-replay anchor), so render the phrase screen normally — renderGreeting shows the digits
        // (name-less) when skipGreeting. Set a lighter title; the live prompt comes from renderGreeting.
        _setPhase(_PHASE.GREETING);   // L-2246: arm GREETING before initial render so guard passes
        try { var _stG = document.getElementById('step2Title'); if (_stG) { _stG.textContent = 'Quick re-confirm'; _stG.style.color = ''; } } catch(_) {}
        try { renderGreeting(); } catch(_) { CaptureFeedback.updatePhasePrompt(ctx, 0); }
    } else {
        _setPhase(_PHASE.GREETING);   // L-2246: arm GREETING before initial render so guard passes
        try { renderGreeting(); } catch(_) { CaptureFeedback.updatePhasePrompt(ctx, 0); }   // F-563: greeting first-class render (fn hoisted); fallback to the old prompt if anything's off
    }

    // ── Finger-phase shared state ──────────────────────────────────────────
    // S111: log the EXPECTED challenge digits at record start so the QA overlay can show
    // exp:N next to detected cnt: — a stuck digit then reveals malformed-challenge (exp is a
    // repeat the backend can't produce) vs misdetection (cnt != exp). Pacing/diagnostic only.
    try { vacDebug('challenge_digits', null, { digits: digits }); } catch(_) {}
    let detectedDigits = new Array(digits.length).fill(false);
    // W3.5: lift detectedCounts to window scope so the upload step can attach
    // it as a client-detected-sequence hint for server-side cross-validation.
    window.__vacDetectedCounts = new Array(digits.length).fill(0);
    let detectedCounts = window.__vacDetectedCounts;  // actual finger count seen per position
    // F-GESTURE-ZONE-QUALIFIES-POSE: per-pose "was the hand in-zone" signal, APPENDED once per
    // accepted pose (same per-pose event that writes detectedCounts, below) so it stays index-
    // aligned 1:1 with the non-zero count sequence the backend reconstructs. Built independent of
    // the n>0 zero-filter (we only ever push a REAL detected pose, never a placeholder 0), so the
    // backend gets a zone for every pose — including an out-of-zone retry it must drop. Reset here
    // (not just created) so a re-auth can't inherit the prior attempt's zones (F-563 stale-state
    // family). true=in-zone, false=positively out-of-zone, null=zone undeterminable (sensor gap).
    window.__vacPoseZones = [];
    let digitJustSeen = false;  // debounce: require fingers-down between gestures
    // W4.1 stability gate: require a count to be HELD STABLE for ~0.6s before
    // accepting it, so the loop advances on a deliberate hold — not on the first
    // transient frame of any finger (which raced through all 3 digits in ~2s).
    let stableCount = 0;          // the count currently being "held" and counted toward stability
    let stableFrames = 0;         // consecutive frames that count has been steady
    let _acceptArmed = true;      // Option 2 (S111): speech-off re-arm — a continuous hold can't double-accept. Re-armed by a SUSTAINED release OR a stably-held DIFFERENT count (debounced, robust to transient miscounts; codex P2). The VAD path ignores this and uses the per-digit speech window as the new-digit signal, which makes repeated digits ([2,4,4]) solvable.
    let _lastAcceptedCount = 0;   // speech-off re-arm: a stably-held count != this == a deliberate change
    let _releaseFrames = 0;       // consecutive detected===0 frames; a SUSTAINED release (>=3) re-arms (1-frame dropouts don't)
    let _releaseSince = 0;        // S155: perf.now() when the CURRENT continuous detected===0 run began; 0 = hand present (mirrors the audio hysteresis pattern — wall-clock, not frame count)
    const STABLE_FRAMES_NEEDED = 12;  // ~0.6s at ~20fps — a deliberate hold, not a flicker
    const MIN_DIGIT_DWELL_MS = 700;   // S110: each digit must be held ~0.7s wall-clock before advancing, so the recorded video captures every pose for Gemini (frame-rate independent) — S155: already exceeds the FINGER_HOLD_MIN_MS positive-evidence floor (400ms), no change needed here
    // S155 POSITIVE-EVIDENCE FLOOR — finger release (D-VERDICT-COMPOSITION companion). The old
    // release/re-arm signal (_releaseFrames >= 3) was a raw FRAME COUNT, which is fps-dependent:
    // ~150ms at 20fps but only ~50ms at 60fps, so on a fast device a single dropped/blinked
    // detection pair could satisfy it and false-re-arm mid-gesture. Schmitt trigger, wall-clock:
    // release now requires the hand to read fully absent (detected===0 — outside even the widened
    // GESTURE_ZONE_SPEC acceptance geometry, the strictest "gone" reading available) for a
    // SUSTAINED period, AND a frame-count floor raised 1.3x over the old bare-minimum (3 -> 4) as
    // a belt-and-suspenders minimum-sample-count alongside the new time floor — mirrors
    // AUDIO_ONSET_RELEASE's asymmetric arm/release hysteresis band. This only makes RE-ARM slower
    // to trigger (never faster) — it cannot loosen acceptance, so it stays inside the DESIGN RULE's
    // bias-permissive mandate (client gates are pacing aids, never the security boundary).
    const FINGER_RELEASE_SUSTAIN_MS = 300;
    const FINGER_RELEASE_MIN_FRAMES = Math.ceil(3 * 1.3);  // 4
    let _confirmUntil = 0;            // S110: during a confirmation beat after an accept, pause new accepts + delay next-number reveal
    const CONFIRM_BEAT_MS = 900;      // length of the "Got it ✓" beat between digits
    let _confirmStripPending = -1;    // digit index whose strip-highlight is waiting for the beat to end
    let currentDigitIndex = 0;
    let rafId = null;
    let recordingStopped = false;
    let digitStartTime = 0;
    let hintShown = false;
    const HINT_TIMEOUT_MS = 8000;
    let _qaGestureLatched = false;  // F-560: gesture-confirmed fires once per digit, reset on advance
    let _gestureReadyAt = 0;        // F-561: when gesture first went ready for this digit (drives the stuck-user escape timer)
    let _latchedCount = 0;          // F-563: the finger count SHOWN at the moment the gesture latched — recorded as the client-detected count at advance (the hand may be DOWN by advance time during the camera-free say step, so we can't read `detected` then)
    let _latchedFrames = 0;         // F-563: stableFrames at latch, for the advance log
    let _escapeAdvancePending = false;  // F-563: the mic-escape was tapped on the say step (gesture already latched, hand down) — let THIS digit through via the latch even though escape switches to speech-off (which otherwise requires a live hand-up gesture)
    let _qaBeatLastLogT = 0;        // S429: throttle state for the ?qa=1 per-beat non-advance log — display-only, decides nothing
    let _qaBeatLastReason = '';     // S429: last logged reason, so a reason CHANGE logs immediately even inside the throttle window

    // ── F-561: per-digit ON-DEVICE voice-pacing gate (energy-VAD) ──────────────
    // The advance gate becomes gesture AND speech: a digit advances only once the
    // user has BOTH held the gesture AND spoken during this digit's window, so the
    // flow is user-paced instead of racing ahead. THIS IS A UX PACING SIGNAL ONLY,
    // NOT the security check — it runs on-device (VAD energy, no network, words
    // never leave the device); server-side Gemini stays the content authority.
    let speechReady = new Array(digits.length).fill(false);  // per-digit: did we hear voice in its window
    let _voiceFiredAt = 0;        // SHOW-AS-YOU-SAY: perf.now() when sustained voice last fired — must CO-OCCUR with a live gesture within DIGIT_COOCCUR_MS to advance
    // F-599 adaptive co-occurrence coaching state. The gate already distinguishes the per-digit
    // near-miss states (voice fired + gesture seen but co-occur EXPIRED); these surface them as a
    // coaching subtitle so the silent expiry no longer catches users out. Debounced so the hint
    // reads as POST-attempt coaching, not a frame-by-frame flicker.
    let _coachKeyShown = 'none';   // the coaching key currently DISPLAYED (after debounce): 'none'|'nearmiss'|'voiceonly'|'gestureonly'
    let _coachCandidate = 'none';  // the candidate computed THIS frame, pending the debounce
    let _coachCandidateAt = 0;     // perf.now() when the current candidate first appeared
    let speechWindowStart = Infinity;  // speech only counts at/after this; Infinity = CLOSED until a digit's window explicitly opens (fail-closed; codex P2)
    let _speechMode = 'pending';     // 'vad' (on-device gate active) | 'off' (gesture-only + visible note)
    let _vadRAF = null;              // energy-VAD requestAnimationFrame handle
    let _speechGateStarted = false;
    let _lastVadRms = 0;             // latest VAD RMS, surfaced to the QA overlay for live calibration
    let _lastVbRatio = 0;            // BUILD 379: latest voice-band ratio (85Hz-3kHz / all bins), surfaced to the QA overlay
    // D-VOICE-GATE-SPEAKER-AGNOSTIC: content gate state (per-digit, reset on advance)
    let _contentGate = null;         // active SpeechRecognition content gate for the current digit
    let _contentGateDigit = -1;      // digit index the active gate covers
    let _vadEnergyDetected = false;  // energy heard this digit window (health only — never triggers progression)
    // Session-local shadow of module-level _contentGateAvail. Runtime permission failures set this
    // to false (energy fallback) without corrupting the module-level var and degrading future sessions.
    let _sessionGateAvail = _contentGateAvail;

    // S145d: shared Mic-pill VU drawer — fast attack (voice snaps the bar up), slow release
    // (decay 0.86/frame ≈ smooth fall), and color hysteresis (green at thr, back to grey only
    // below 0.85*thr) so the bar reads calm instead of jittering at the line. Display-only —
    // gates everywhere still read the RAW rms.
    let _micBarDisp = 0, _micBarVoiced = false;
    function _micPillDraw(rms, thr, tag) {
        try {
            window.__vacMicThr = thr;  // S145e: last-drawn threshold, published for external/QA introspection (S429: the pre-flight monitor computes its own live floor now, no longer reads this back as a fallback)
            // S145g: the pill row lives ONLY on the preflight screen — the ceremony STEP view
            // (greeting/digits, where the user actually speaks) replaces it (Rob screenshot,
            // hotel run). So while a speech gate is armed, ALSO maintain a compact fixed meter
            // bottom-center: same bar, same gold line, same numbers. Removed at gate-off.
            if (window.__vacGateArmed) {
                var _ov = document.getElementById('vacStepVU');
                if (!_ov) {
                    _ov = document.createElement('div');
                    _ov.id = 'vacStepVU';
                    // S145h (Rob): anchored INSIDE the camera frame — a viewport-fixed meter floated
                    // over page text on scroll. Inside the video wrapper it scrolls with the ceremony
                    // and covers nothing. Fallback to fixed only if no video host exists.
                    // S145i: b9 anchored to #videoPreview — the PREFLIGHT video, hidden in the
                    // step view, so the bar drew inside a display:none box. Anchor to whichever
                    // video is VISIBLE right now instead.
                    var _vp = null;
                    document.querySelectorAll('video').forEach(function(v){ if (!_vp && v.offsetWidth > 0 && v.offsetParent !== null) _vp = v; });
                    var _host = (_vp && _vp.parentElement) ? _vp.parentElement : null;
                    if (_host) {
                        try { if (getComputedStyle(_host).position === 'static') _host.style.position = 'relative'; } catch(_) {}
                        _ov.style.cssText = 'position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:min(240px,72%);z-index:60;pointer-events:none;font-family:-apple-system,system-ui,sans-serif;';
                    } else {
                        _ov.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:min(260px,76vw);z-index:99999;pointer-events:none;font-family:-apple-system,system-ui,sans-serif;';
                    }
                    _ov.innerHTML = '<div style="height:9px;border-radius:5px;background:rgba(10,15,26,.8);border:1px solid rgba(255,255,255,.28);position:relative;overflow:visible;">'
                      + '<div id="vacStepVUfill" style="height:100%;width:0%;background:#8b97ad;border-radius:5px;transition:width 50ms linear;"></div>'
                      + '<div style="position:absolute;top:-4px;bottom:-4px;left:40%;width:2px;background:#fbbf24;border-radius:1px;"></div></div>'
                      + '<div id="vacStepVUtxt" style="text-align:center;font-size:11px;color:#c9d4e8;margin-top:3px;text-shadow:0 1px 2px rgba(0,0,0,.85);"></div>';
                    (_host || document.body).appendChild(_ov);
                }
            }
            _micBarDisp = (rms > _micBarDisp) ? rms : Math.max(rms, _micBarDisp * 0.86);
            if (!_micBarVoiced && rms > thr) _micBarVoiced = true;
            else if (_micBarVoiced && rms < thr * 0.85) _micBarVoiced = false;
            var _mf = document.getElementById('avMicBarFill');
            if (_mf) { var _w = Math.min(100, Math.round((_micBarDisp / (thr * 2.5)) * 100)); _mf.style.width = _w + '%'; _mf.style.background = _micBarVoiced ? '#43d692' : '#8b97ad'; }
            var _mr = document.getElementById('avRmsReadout');
            if (_mr) _mr.textContent = rms.toFixed(2) + '/' + thr.toFixed(2) + ' ' + tag;
            // S145i: if the view swapped and our host got hidden, remove — next armed frame recreates in the visible host.
            var _svp = document.getElementById('vacStepVU');
            if (_svp && _svp.offsetParent === null) { try { _svp.remove(); } catch(_) {} }
            var _sf = document.getElementById('vacStepVUfill'), _st = document.getElementById('vacStepVUtxt');
            if (_sf) { var _w2 = Math.min(100, Math.round((_micBarDisp / (thr * 2.5)) * 100)); _sf.style.width = _w2 + '%'; _sf.style.background = _micBarVoiced ? '#43d692' : '#8b97ad'; }
            // D-VOICE-GATE-SPEAKER-AGNOSTIC: meter shows what the gate actually uses
            var _gateDesc = _sessionGateAvail ? 'content-gated — say the word' : 'mic health — speak past the gold line';
            if (_st) _st.textContent = rms.toFixed(2) + '/' + thr.toFixed(2) + ' ' + tag + ' — ' + _gateDesc;
        } catch(_) {}
    }
    try { window.__vacMicPillDraw = _micPillDraw; } catch(_) {}
    let _lastDetectedCount = null;   // F-759: latest client finger count, surfaced to the capture readout
    let _lastVoiceMs = 0;            // R1: current CONTINUOUS voiced-run duration (ms), surfaced to ?qa=1 (vMs) so a tap (never climbs to DIGIT_VOICE_MIN_MS) vs a real digit is visible by eye
    // VAD threshold — client-side energy-RMS (0..1), NOT FolioAI's Deepgram word-confidence
    // (different units entirely). Tuned live (S111, Rob): measured silent floor ~0.074,
    // speaking ~0.175–0.242. 0.14 sits in that gap (clears the floor by ~0.066, ~0.035 below
    // quietest speech). The gap is tight, so FRAMES is raised to require sustained voicing —
    // a brief transient (breath/tap/movement) can't hold above thr for ~100ms and false-fire
    // (the silent-advance bug). Re-tune live on ?qa=1 by watching rms (silent) vs rms (speaking).
    // F-595 per-session AUTO-CALIBRATION. The hand-tuned 0.14/0.085 pair was Rob's OLD mic;
    // hand-retuning just moves the bug onto the next user's hardware. So these are now only the
    // FALLBACK (used until the greeting phase calibrates, or if calibration can't run). The DIGIT
    // gate reads the per-session vadSpeechThreshold / vadSilenceThreshold derived from THIS user's
    // measured noise floor + greeting loudness. NO per-device constant is shipped.
    const VAD_SPEECH_RMS_FALLBACK = 0.055;   // task-644: 0.115→0.085 for time-domain RMS scale (getByteTimeDomainData √mean((v-128)²)/128). S145 was freq-domain; time-domain speech at normal volume reads 0.05-0.25 so 0.085 is accessible without shouting.
    const VAD_SILENCE_RMS_FALLBACK = 0.030;   // task-644: 0.085→0.030; time-domain ambient noise is 0.005-0.025 so 0.030 is below speech but above true silence. Hysteresis gap = "neither"; onset gate unchanged.
    // R1 (S114): the digit sustained-voice gate is TIME-based, not a frame count. The old
    // `voiced >= VAD_SPEECH_FRAMES(6)` measured rAF FRAMES, whose wall-clock varies by display
    // refresh (6 frames = ~100ms@60Hz but ~50ms@120Hz). It's gone; DIGIT_VOICE_MIN_MS (below) is
    // the sole sustained-duration gate. See _startSpeechGate for the continuity fix that makes the
    // 350ms measure GENUINELY continuous voicing (the noisy-room tap-through Rob hit accumulated
    // sparse transients across the silence..speech "neither" band, where the run was never reset).
    // F-595: live per-session thresholds the DIGIT gate reads (NOT the constants).
    // D-VAD-CALIBRATION-GREETING-BOUND: arm from the PREFLIGHT's measured ambient + speaking
    // level (module-scope _micPreflightVad — survives from the AV check into this ceremony)
    // instead of blind fallback constants, so the phrase-phase VAD can actually hear the
    // greeting in a noisy room. The greeting phase below still refines these once it hears the
    // user directly (A2/A3); preflight is the ARMED starting point, not a replacement for it.
    // Only falls back to the hand-tuned constants when the preflight never measured both
    // quantities (AV check skipped, or the mic never qualified) AND the rolling floor is also
    // unmeasured. S155: _fastCalThreshold(audioNoiseFloor) is the PER-SPEAKER shared-helper tier —
    // used ONLY when the full preflight calibration is unavailable, never overriding it.
    // S157 C1: continuous floor-relative VAD. Preflight calibration is seed-only — it may warm
    // the initial EMA floor estimate when available, but the rolling audioNoiseFloor (EMA-adapted
    // on non-voiced frames by startAudioMonitor) is the authority. Thresholds derive from the live
    // floor at arm time and re-derive at each new digit window while idle (frozen during onset and
    // voiced runs so the bar cannot move mid-attempt). phraseSpoke recalibration (F-595) still runs
    // and overrides thresholds once the greeting is measured; this is the pre-greeting starting point.
    const _preflightVad = _micPreflightVad();  // kept for phraseSpoke recalibration path + _calIsFallback
    // Preflight as seed: nudge audioNoiseFloor toward the preflight-measured floor (upward only — do
    // not overwrite a live floor already adapting in a noisy room with a quieter measurement).
    if (_preflightVad && _preflightVad.floor > audioNoiseFloor) {
        audioNoiseFloor = _preflightVad.floor * 0.4 + audioNoiseFloor * 0.6;
    }
    let vadSpeechThreshold = 0, vadSilenceThreshold = 0;
    (function _deriveThresholdsArm() {
        var _flr = (audioNoiseFloor > 0.001) ? audioNoiseFloor : 0.010;
        vadSpeechThreshold = Math.max(_flr + ADAPTIVE_SPEECH_DELTA, ADAPTIVE_THR_MIN);
        if (vadSpeechThreshold > ADAPTIVE_THR_MAX) vadSpeechThreshold = ADAPTIVE_THR_MAX;
        vadSilenceThreshold = Math.max(_flr + ADAPTIVE_SILENCE_DELTA, 0.006);
        if (vadSilenceThreshold > vadSpeechThreshold - 0.005) vadSilenceThreshold = vadSpeechThreshold - 0.005;
        _adaptLastFloor = _flr;
    })();
    // F-595 calibration sampling state. _floorSamples = leading near-silent greeting frames
    // (the room's noise floor); _speechSamples = the voiced greeting run (this user speaking).
    // Both medians (robust to a cough/click) feed the threshold at phraseSpoke. Function-scoped,
    // so they reset fresh every recording (no stale per-session value bleeds into a re-auth).
    let _calNoiseFloor = null, _calSpeechRms = null, _calIsFallback = !_preflightVad;
    const _floorSamples = [], _speechSamples = [];
    const _CAL_FLOOR_MAX = 8;        // cap leading-silence collection at 8 samples (up to ~1.6s at TICK_MS=200, but collection stops the moment the user starts speaking, so usually fewer) — enough for a stable median, never blocks the flow
    const _CAL_MIN_FLOOR = 3;        // need >=3 floor samples for a trustworthy median, else keep fallback
    const _CAL_SPEECH_MAX = 40;      // cap voiced-run collection (a normal greeting is ~7-20 voiced ticks; this bounds a pathologically long one) — symmetry with _floorSamples, median stays representative
    // _CAL_K / _CAL_SIL_K / _CAL_MIN_SPAN / _calClamp now live at module scope (shared with
    // _micPreflightVad and the FAST tier) — see the definitions near _micQualifyFloor.
    function _calMedian(a) { if (!a.length) return null; const s = a.slice().sort(function(x,y){return x-y;}); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; }
    // D-VAD-UNITS (task-447): floor/speech below are now ceremony-RMS-scale (0-1, same units as
    // thr/sil) — floor_pct/speech_pct carry the RAW time-domain preflight samples (0-100) alongside
    // them so a field run can verify the two quantities directly instead of inferring a conversion.
    try { vacDebug('vad_calibrated', null, { at: 'arm', floor: Number(audioNoiseFloor.toFixed(3)), preflight_floor: _preflightVad ? Number(_preflightVad.floor.toFixed(3)) : null, preflight_speech: _preflightVad ? Number(_preflightVad.speech.toFixed(3)) : null, floor_pct: _micSeededAmbient ? Number(_micSeededAmbient.toFixed(1)) : null, speech_pct: _micSeededSpeechLevel ? Number(_micSeededSpeechLevel.toFixed(1)) : null, thr: Number(vadSpeechThreshold.toFixed(3)), sil: Number(vadSilenceThreshold.toFixed(3)), fallback: _calIsFallback, source: 'continuous_floor' }); } catch(_) {}
    // F-563 (#1): the digit say-step got the SAME tap/beep weakness the greeting had — the old
    // ~100ms (VAD_SPEECH_FRAMES) bar let a tap/beep satisfy a digit. A SPOKEN number is ~300-500ms
    // and MODULATED (a flat beep isn't). So require SUSTAINED voiced energy over a spoken-digit
    // duration AND modulation. Shorter than the greeting's 1.4s (a single digit < a multi-word
    // greeting). PACING ONLY — Gemini server-side stays the authoritative voice check. LIVE-TUNE.
    // ═══════════════════════════════════════════════════════════════════════════
    // DESIGN RULE (Rob directive, S154) — READ BEFORE TUNING ANY CONSTANT BELOW:
    // The on-device gates (VAD, MediaPipe fingers, zones) are a PACING/UNIFORMITY
    // AID for the backend — a camera operator, not a bouncer. Their job is a clean,
    // well-framed capture per digit (one utterance + one gesture, separated beats)
    // so server-side validation (Gemini: deepfake, lip-sync, gesture↔number match)
    // receives uniform input. Security lives SERVER-SIDE. Therefore: when a client
    // gate rejects real users, loosen the client and let the server judge — client
    // strictness must justify itself as capture QUALITY (framing/uniformity),
    // never as security. Bias permissive. (S154 specimen: the 250ms zero-dip onset
    // hold rejected normally-spoken digits while adding no security the dual
    // spectral checks + server validation didn't already provide.)
    // ═══════════════════════════════════════════════════════════════════════════
    const DIGIT_VOICE_MIN_MS = 270;  // S145j live-tune (Rob, hotel e2e): 350 rejected a briskly-said 'two' (bar clearly over threshold, duration under floor — slow retry passed). 270 admits a natural quick monosyllable (~250-300ms) while keeping ~2.5x margin over a ~100ms tap; modulation + hysteresis + Gemini server-side remain the real anti-tap guards.
    const DIGIT_VOICE_GAP_MS = 200;  // R1: max sustained OBSERVED dip (neither-band frames) within one voiced run. A real intra-word dip is brief; spaced taps leave a long neither-band gap between them. Gated on OBSERVED dip frames (not a bare inter-frame time delta) so rAF jank — a skipped frame — can't fake a gap and false-reject a real digit (adversarial-review F1).
    // F-662: DIGIT_COOCCUR_MS / DIGIT_COOCCUR_MAX_MS moved to module scope (ONE source, shared with the
    // FAST tier via _cooccurAdvanceDecision). Same values; the inline gate below now calls that helper.
    const DIGIT_MOD_DELTA = 0.030;   // the voiced run's rms must vary at least this much — a flat tone/beep (~0 range) can't satisfy a digit; a spoken digit's vowel envelope does
    const VAD_ONSET_SUSTAIN_MS = 180; // S154 field-tune (Rob, Sicily e2e): 250→180. The 250ms no-gap hold rejected naturally-spoken digits with soft onsets ("four" — /f/ fricative dips a frame; dragged speech passed, normal speech aborted at the hard single-frame reset below, now dip-tolerant). Tap defense unchanged in depth: dual spectral checks (onset + mid-window) + modulation + Gemini server-side remain. Original S139-v2 note: raised 180→250ms — floor = shortest voiced digit "one/uno" (~250ms phonation). The previous 180ms was vulnerable to two quick desk-taps ~100-150ms apart: the smoothed analyser envelope stayed above threshold continuously across both taps, so the pre-onset timer never reset between them.
    const VAD_ONSET_DIP_MS = 60;     // S154: max OBSERVED neither-band dip tolerated WITHIN the pre-onset sustain window (mirrors the R1 observed-dip pattern post-onset). A soft consonant dips 1-3 frames (~20-50ms); spaced desk-taps sit 100-150ms apart and still break. Silence always aborts instantly.
    const VAD_VOICE_BAND_FRAC = 0.35; // S139-v2: mid-band 300-3500Hz energy fraction, raised 0.20→0.35. Band narrowed from 0-3.5kHz to exclude LF thump (<300Hz). Desk-tap thumps are sub-200Hz (excluded from mid-band window); voice concentrates formants F1/F2 in 300-3000Hz. Flat-broadband baseline in a 17-bin mid window = ~13.3%, so 0.35 rejects any non-voice signal. Checked at onset-start AND mid-window frames.
    // BUILD 379 (Rob restaurant fix): a loud BROADBAND room (chatter/clatter) can push rms over
    // vadSpeechThreshold without being voice-concentrated — false-arming "voiced" and burning the
    // amplitude-only gate's margin. Rather than lowering the amplitude floor (which just admits more
    // noise), gate every frame's amplitude-pass on the spectrum ALSO being voice-band-dominant. Wider/
    // lower band than VAD_VOICE_BAND_FRAC above (85Hz floor, not 300Hz) since this runs on EVERY frame
    // (not just onset) and must not clip a voice's low formants; the higher ratio (0.55) compensates.
    const VOICE_BAND_MIN_RATIO = 0.45; // S148 field-tuned (was 0.55) — see line ~483 note. tunable — frame counts as voiced only if this fraction of FFT energy sits in 85Hz-3kHz, AND the existing amplitude gate passes.
    function _voiceBandRatio(analyser, buf) {
        var _sr = (analyser.context && analyser.context.sampleRate) || 48000;
        var _vbStart = Math.ceil(85 * analyser.fftSize / _sr);
        var _vbEnd = Math.floor(3000 * analyser.fftSize / _sr);
        var _vbSum = 0, _totSum = 1;
        for (var _vi = 0; _vi < buf.length; _vi++) { _totSum += buf[_vi]; if (_vi >= _vbStart && _vi <= _vbEnd) _vbSum += buf[_vi]; }
        return _vbSum / _totSum;
    }
    const COACH_DEBOUNCE_MS = 600;   // F-599: a coaching candidate must persist this long continuously before it shows — so the hint appears AFTER a genuine failed attempt, not mid-gesture. 'none' clears instantly (no lag on advance/correction).
    const VOICE_HELP_TIMEOUT_MS = 12000;  // gesture held ready this long w/o speech → offer the mic escape
    // F-561 per-digit cross-modal binding (SUPP-7): speechReady[i] fires ONLY on a FRESH
    // silence→voice ONSET inside digit i's window, so the spoken number genuinely binds to
    // that gesture (no pre-satisfaction). Reusable per-digit unit for F-562 quick re-auth.
    let _sawSilence = false;         // observed real silence since THIS digit's window opened?
    let _voiceOnsetAt = 0;           // performance.now() when the current fresh voiced run began
    let _preOnsetStart = 0;          // S139: perf.now() when continuous above-threshold pre-onset accumulation began; 0 = not accumulating. Resets on any non-above-threshold frame.
    let _preOnsetDipStart = 0;  // S154: start of the current tolerated pre-onset dip (0 = not dipping)
    let _preOnsetMidChecked = false; // S139-v2: true once the mid-window spectral re-check has run in the current pre-onset window; reset when _preOnsetStart resets.
    let _rejectedTransients = 0;     // S139: count of onset attempts killed by the onset sustain gate (taps that dropped before 250ms)
    let _lastRejectReason = '';      // S139-v2: 'spec' (spectral mid-band check) | 'sust' (sustain dip/silence); surfaced in the QA debug readout

    function finishFingerPhase() {
        if (recordingStopped) return;
        recordingStopped = true;
        _setPhase(_PHASE.PROCESSING);   // L-2246: stop any stale digit-phase render loops painting coaching text
        try { var _ds=document.getElementById('digitStrip'); if(_ds) _ds.style.display='none'; } catch(_) {}
        try { var _gp=document.getElementById('vacGuided'); if(_gp) _gp.style.display='none'; } catch(_) {}  // F-563 (2): hide the guided panel when capture ends
        try { var _sv=document.getElementById('vacSayView'); if(_sv) _sv.style.display='none'; } catch(_) {}  // F-563 (latch): hide the say-cover when capture ends
        try { var _eg=document.getElementById('vacEqGreeting'); if(_eg) _eg.style.display='none'; } catch(_) {}  // F-563 (2): hide the greeting eq when capture ends
        try { _hideNoMicRecovery(); } catch(_) {}  // F-563: clear the no-mic recovery panel when capture ends
        try { var _fh=document.getElementById('framingHint'); if(_fh) _fh.style.display='none'; } catch(_) {}
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        challengeEl.textContent = 'Processing\u2026';
        // F-815 (Rob, 16 Jul pre-meeting run): entering processing must not keep coaching the
        // user — the live coach line ('Keep showing N — say N') was persisting under
        // 'Processing…', giving an instruction and a wait-state simultaneously. Clear it,
        // hide the REC chip, and after the recording tail freeze the preview: a live camera
        // under 'Processing' reads oddly against the recording-already-ended privacy note.
        try { if (typeof liveEl !== 'undefined' && liveEl) { liveEl.textContent = 'Analysing your recording\u2026 (first verification can take a little longer)'; liveEl.style.color = ''; } } catch(_) {}
        try { document.querySelectorAll('.rec-dot').forEach(function(d){ var p=d.parentElement; if(p) p.style.display='none'; }); } catch(_) {}
        setTimeout(function(){
            try { var v = ctx && ctx.byId ? (ctx.byId('vacVideo')||document.querySelector('video')) : document.querySelector('video'); if (v && !v.paused) v.pause(); } catch(_) {}
        }, 1700);
        // S110 detection<->recording sync fix: detection can race ahead of the
        // recorded video (Gemini saw only the first digit of [2,3,5]). Keep the
        // recorder running a tail buffer AFTER the last digit so the video
        // actually contains footage of every digit pose before we stop + send
        // to Gemini. 1500ms tail (was 500ms) ensures the final digit is filmed.
        try { _stopSpeechGate(); } catch(_){}
        // D-VOICE-GATE-SPEAKER-AGNOSTIC: stop phrase content gate when recording ends
        try { if (_phraseContentGate) { _phraseContentGate.stop(); _phraseContentGate = null; } } catch(_) {}
        try { _removeVoiceEscape(); var _vn=document.getElementById('vacVoiceOff'); if(_vn) _vn.remove(); } catch(_){}
        _legitStopScheduled = true; // F-720: mark the ONLY legitimate stop before the delayed call
        setTimeout(function() { try { mediaRecorder.stop(); } catch(_){} }, 1500);
    }

    // ── F-561 voice-pacing gate (content-gated, D-VOICE-GATE-SPEAKER-AGNOSTIC) ──
    // D1 (task-voice-content-gate): SpeechRecognition is NOW used for content-gated
    // progression — the transcript must match the expected digit/phrase. Energy/RMS is
    // DEMOTED to mic-health indicator only (never advances the ceremony).
    // Prior concern (S111): "webkitSpeechRecognition streams to Google" — intentional
    // security upgrade: content-match safety > energy-only approach. The challenge digits
    // are already transcribed server-side via Deepgram. Non-matching audio is discarded.
    // Fallback: when SpeechRecognition unavailable (Firefox), energy VAD governs as before.

    // Refresh the per-digit content gate when the digit changes or it was consumed.
    function _refreshContentGate() {
        if (recordingStopped || _speechMode !== 'vad') return;
        if (_contentGate) return; // still running for this digit
        if (currentDigitIndex >= digits.length || speechReady[currentDigitIndex]) return;
        if (!_sessionGateAvail) return; // energy fallback — no gate to start
        var targetDigit = digits[currentDigitIndex];
        var _gateForIdx = currentDigitIndex;  // capture index; guard against stale async callback
        _contentGateDigit = currentDigitIndex;
        _contentGate = _startDigitContentGate(targetDigit, function(t) {
            _contentGate = null; _contentGateDigit = -1;
            // Guard: if digit advanced while recognition was async, discard this result.
            if (currentDigitIndex !== _gateForIdx || speechReady[_gateForIdx]) return;
            try { vacDebug('content_gate_fired', null, { digit_index: _gateForIdx, digit: targetDigit }); } catch(_) {}
            _markSpeech('content', 0, null);
        }, function() {
            // Fatal STT error (not-allowed/audio-capture): null the outer handle so the
            // VAD loop doesn't see a non-null but dead gate, and fall back to energy VAD.
            _contentGate = null; _contentGateDigit = -1; _sessionGateAvail = false;
        }, function(t) {
            // task-653 no-match fallback: transcripts never matched expectedDigit for >=4s
            // with VAD confirming voice. Provisional client pass — server gate is authority.
            _contentGate = null; _contentGateDigit = -1;
            if (currentDigitIndex !== _gateForIdx || speechReady[_gateForIdx]) return;
            try { vacDebug('content_gate_no_match_fallback', null, { digit_index: _gateForIdx, digit: targetDigit, transcript: t ? String(t).slice(0, 60) : null }); } catch(_) {}
            _markSpeech('no_match_fallback', 0, null);
        }, function() {
            // vadProbe: is the VAD currently registering sustained voice?
            // Use _vadEnergyDetected only — it requires 180ms sustained onset + dual spectral
            // checks + modulation. A single-frame _lastVadRms spike from broadband ambient noise
            // would satisfy the OR arm and start the no-match timer incorrectly.
            return _vadEnergyDetected;
        });
        if (!_contentGate) {
            // _startDigitContentGate returned null despite _sessionGateAvail being set —
            // likely a runtime permission error. Degrade to energy fallback for this session only.
            _sessionGateAvail = false;
            try { vacDebug('content_gate', 'runtime_unavailable', { digit: targetDigit }); } catch(_) {}
        }
    }

function _markSpeech(src, rms, onsetAt) {
        if (recordingStopped) return;
        if (currentDigitIndex >= digits.length) return;
        if (performance.now() < speechWindowStart) return;  // ignore tail bleeding from the prior digit (still in its beat)
        if (speechReady[currentDigitIndex]) return;         // already satisfied for this digit
        speechReady[currentDigitIndex] = true;
        _vadEnergyDetected = false;  // reset health flag for next digit
        // Content gate consumed for this digit — stop it; new gate starts on next digit
        if (_contentGate) { _contentGate.stop(); _contentGate = null; _contentGateDigit = -1; }
        _voiceFiredAt = performance.now();   // SHOW-AS-YOU-SAY: stamp the spoken-digit moment for the co-occurrence window
        // S111 unification: a FRESH per-digit speech onset is ALSO a deliberate "new digit"
        // signal, so it satisfies the gesture re-arm — the user doesn't have to lower their
        // hand even when MediaPipe misread the count (cnt≠exp). The held gesture + the spoken
        // number advance; Gemini validates the actual gesture↔number match server-side (SUPP-7).
        // Hand-lower stays only as the speech-off / genuinely-stuck fallback.
        _acceptArmed = true;
        // F-561: carry the triggering rms AND the silence→voice onset moment, so the overlay
        // shows the FRESH binding per digit (onset after a real in-window silence — no pre-satisfaction).
        try { vacDebug('speech_confirm', null, { digit_index: currentDigitIndex, src: src, rms: (typeof rms === 'number' ? Number(rms.toFixed(3)) : null), onset_perf: (typeof onsetAt === 'number' ? onsetAt : null) }); } catch(_) {}
    }
    function _startSpeechGate() {
        if (_speechGateStarted) return;
        _speechGateStarted = true;
        if (!audioAnalyser) { console.error('[VAC][VOICE] digit voice gate OFF — no audioAnalyser at speech-gate start (pacing only; Gemini still validates voice server-side)'); _speechGateOff('no_audio_analyser'); return; }  // W4.1: degrade to gesture-only + note
        if (window.__vacVoiceSkipped) { _speechGateOff('user_skip'); return; }  // user picked "Continue — skip voice" on the recovery → digits go gesture-only too
        _speechMode = 'vad';
        try { vacDebug('speech_gate_mode', null, { mode: _sessionGateAvail ? 'content+vad' : 'vad_energy_fallback' }); } catch(_) {}
        // D-VOICE-GATE-SPEAKER-AGNOSTIC: start content gate for the first digit
        _refreshContentGate();
        const buf = new Uint8Array(audioAnalyser.frequencyBinCount);    // freq-domain — voiceBandRatio only
        const _tdBuf = new Uint8Array(audioAnalyser.fftSize);           // time-domain — RMS only (task-644)
        let voiced = 0;
        let voiceMin = 1, voiceMax = 0;   // F-563 (#1): rms range over the current voiced run (the modulation check)
        let _voicedAboveThrFrames = 0;   // S155: count of individual frames read above vadSpeechThreshold this run (VOICE_EVIDENCE_MIN_FRAMES floor) — independent of the wall-clock duration check
        let _voiceDipStart = 0;          // R1: perf.now() when the current within-run dip (an OBSERVED neither-band frame) began; 0 = voicing/not in a dip. A dip sustained > DIGIT_VOICE_GAP_MS breaks the run.
        // The reusable per-digit unit: fire speechReady ONLY on a silence→voice ONSET inside
        // the current window. A voiced run that did NOT follow an in-window silence (greeting
        // tail, continuous talk, room drone) is IGNORED — so it can't pre-satisfy the digit and
        // the spoken number genuinely binds to the gesture (SUPP-7 cross-modal claim, on-device).
        (function tick() {
            if (recordingStopped || _speechMode !== 'vad') { _vadRAF = null; return; }
            // If the user picked "Continue — skip voice" AFTER the digit VAD already started (they
            // entered the digit phase before clicking it), turn the gate off now so digits don't keep
            // waiting on voice (codex). _startSpeechGate's initial check can't catch this later choice.
            if (window.__vacVoiceSkipped) { _speechGateOff('user_skip'); _vadRAF = null; return; }
            try {
                // task-644: time-domain RMS fixes iOS where getByteFrequencyData stays ~0.01 forever
                audioAnalyser.getByteTimeDomainData(_tdBuf);
                let rms = 0; for (let i = 0; i < _tdBuf.length; i++) { const _v = _tdBuf[i] - 128; rms += _v * _v; }
                rms = Math.sqrt(rms / _tdBuf.length) / 128;
                _lastVadRms = rms;  // surfaced to the QA overlay for live threshold calibration
                audioAnalyser.getByteFrequencyData(buf);   // separate fetch — voiceBandRatio needs freq data
                const vbRatio = _voiceBandRatio(audioAnalyser, buf);  // BUILD 379: fraction of energy in the 85Hz-3kHz voice band
                _lastVbRatio = vbRatio;  // surfaced to the QA overlay
                window.__vacGateArmed = true; _micPillDraw(rms, vadSpeechThreshold, _calIsFallback ? 'p' : 'c');
                const _now = performance.now();
                // S157 C1: continuous floor-relative threshold update. Frozen during onset
                // (_preOnsetStart > 0) and voiced runs (voiced > 0) so the goalposts cannot
                // shift mid-attempt. Only re-derives when the floor has moved meaningfully (>3mRMS).
                if (voiced === 0 && !_preOnsetStart) {
                    var _liveFlr = (audioNoiseFloor > 0.001) ? audioNoiseFloor : 0.010;
                    if (Math.abs(_liveFlr - _adaptLastFloor) > 0.003) {
                        var _newSpeech = Math.max(_liveFlr + ADAPTIVE_SPEECH_DELTA, ADAPTIVE_THR_MIN);
                        if (_newSpeech > ADAPTIVE_THR_MAX) _newSpeech = ADAPTIVE_THR_MAX;
                        var _newSil = Math.max(_liveFlr + ADAPTIVE_SILENCE_DELTA, 0.006);
                        if (_newSil > _newSpeech - 0.005) _newSil = _newSpeech - 0.005;
                        // F-1025 EXPLAIN-AS-YOU-ADAPT: floor shift >30% from last adaptation →
                        // one visible coaching line. Shown in the RMS chip for 3 seconds.
                        if (_adaptLastFloor > 0.005 && Math.abs(_liveFlr - _adaptLastFloor) > _adaptLastFloor * 0.30) {
                            try {
                                var _re = document.getElementById('audioRmsReadout');
                                if (_re) {
                                    _re.setAttribute('data-adapt-msg', '1');
                                    clearTimeout(_adaptExplainTimer);
                                    _adaptExplainTimer = setTimeout(function(){ try { if (_re && _re.getAttribute('data-adapt-msg')) _re.removeAttribute('data-adapt-msg'); } catch(_) {} }, 3000);
                                }
                            } catch(_) {}
                            try { vacDebug('vad_adapt_explain', null, { prev_floor: Number(_adaptLastFloor.toFixed(3)), new_floor: Number(_liveFlr.toFixed(3)) }); } catch(_) {}
                        }
                        vadSpeechThreshold = _newSpeech;
                        vadSilenceThreshold = _newSil;
                        _adaptLastFloor = _liveFlr;
                        try { vacDebug('vad_adapt', null, { floor: Number(_liveFlr.toFixed(3)), thr: Number(vadSpeechThreshold.toFixed(3)), sil: Number(vadSilenceThreshold.toFixed(3)) }); } catch(_) {}
                    }
                }
                // D-VOICE-GATE-SPEAKER-AGNOSTIC: refresh content gate when digit advances
                if (_sessionGateAvail && _contentGateDigit !== currentDigitIndex) {
                    if (_contentGate) { _contentGate.stop(); _contentGate = null; _contentGateDigit = -1; }
                    _refreshContentGate();
                }
                if (rms < vadSilenceThreshold) {
                    // Track silence ALWAYS — even while the window is closed (during the confirm
                    // beat / grace). A real pause there arms the next digit, so a fresh utterance
                    // that OVERLAPS the window-open still counts (codex), while continuous
                    // carry-over (no pause since the last accept) stays rejected.
                    if (_preOnsetStart) { _rejectedTransients++; _lastRejectReason = 'sust'; _preOnsetStart = 0; _preOnsetMidChecked = false; _preOnsetDipStart = 0; }  // S139: silence aborts pre-onset (S154: dip tracker cleared too)
                    _sawSilence = true;
                    if (voiced > 0) { _vadDiag('run ended: ' + Math.round(_now - _voiceOnsetAt) + 'ms pk ' + (voiceMax*100).toFixed(0) + '% mod ' + ((voiceMax-voiceMin)*100).toFixed(1) + ' | need ' + DIGIT_VOICE_MIN_MS + 'ms above ' + (vadSpeechThreshold*100).toFixed(0) + '% mod ' + (Math.max(0.012, 0.10*voiceMax)*100).toFixed(1)); try { vacDebug('vad_gate', 'run_ended', { path:'full', dur_ms: Math.round(_now - _voiceOnsetAt), peak: Number((voiceMax).toFixed(3)), mod: Number((voiceMax-voiceMin).toFixed(3)), thr: Number(vadSpeechThreshold.toFixed(3)), need_ms: DIGIT_VOICE_MIN_MS, need_mod: Number(Math.max(0.012, 0.10*voiceMax).toFixed(3)), digit_index: currentDigitIndex }); } catch(_){} }  // S154 diag
                    voiced = 0; voiceMin = 1; voiceMax = 0; _voiceDipStart = 0; _voicedAboveThrFrames = 0;   // R1: real silence fully ends the run
                } else if (rms > vadSpeechThreshold && vbRatio >= VOICE_BAND_MIN_RATIO) {
                    // S155: count EVERY individual above-threshold+voice-band sample this attempt
                    // (pre-onset accumulation included, not just post-onset-confirm voicing) —
                    // VOICE_EVIDENCE_MIN_FRAMES reads real observed samples, not a derived state.
                    _voicedAboveThrFrames++;
                    // BUILD 379: amplitude alone crossed the line, but only counts as voiced if the
                    // energy is also voice-band-dominant — a loud broadband room (restaurant) can
                    // cross vadSpeechThreshold without qualifying here, and falls through to the
                    // "neither" branch below (same treatment as a between-thresholds frame).
                    // Accumulate the voiced run from its TRUE onset — even if it starts during the
                    // grace/beat BEFORE the window opens — so a digit begun slightly early still reaches
                    // the duration bar (codex: don't clamp the onset to window-open). The run only STARTS
                    // after a real silence (_sawSilence = fresh onset, rejects carry-over/greeting-tail).
                    if (voiced === 0) {
                        // S139 onset gate: require SUSTAINED above-threshold energy for VAD_ONSET_SUSTAIN_MS
                        // (continuously, no gaps) before confirming onset. A percussive tap (<50ms) drops
                        // back to neither/silence before 180ms, resetting _preOnsetStart — it cannot trigger.
                        // Real speech holds above threshold for 300-500ms and passes easily.
                        if (_sawSilence) {
                            if (_preOnsetStart === 0) {
                                // First frame of potential onset. Mid-band spectral check (same buf, zero latency):
                                // 300-3500Hz energy must dominate. Desk-tap thumps are sub-200Hz LF (bins 0-1,
                                // excluded from the 300Hz lower cut); voice concentrates formants F1/F2 in mid-band.
                                var _sr = (audioAnalyser.context && audioAnalyser.context.sampleRate) || 48000;
                                var _mbStart = Math.ceil(300 * audioAnalyser.fftSize / _sr);
                                var _mbEnd   = Math.floor(3500 * audioAnalyser.fftSize / _sr);
                                var _mbSum = 0, _totSum = 1;
                                for (var _si = 0; _si < buf.length; _si++) { _totSum += buf[_si]; if (_si >= _mbStart && _si <= _mbEnd) _mbSum += buf[_si]; }
                                if (_mbSum / _totSum >= VAD_VOICE_BAND_FRAC) {
                                    _preOnsetStart = _now; _preOnsetMidChecked = false;  // voice-like mid-band; begin sustain window
                                } else {
                                    _rejectedTransients++; _lastRejectReason = 'spec';  // LF-heavy tap rejected at onset frame
                                }
                            } else if (_now - _preOnsetStart >= VAD_ONSET_SUSTAIN_MS) {
                                // Pre-onset confirmed: continuously above threshold for >=250ms.
                                // Backdate _voiceOnsetAt to when pre-onset began so the 350ms DIGIT_VOICE_MIN_MS
                                // measures from actual onset, not confirmation moment.
                                _voiceOnsetAt = _preOnsetStart;
                                voiceMin = rms; voiceMax = rms; voiced = 1;
                                _preOnsetStart = 0; _preOnsetMidChecked = false;
                            } else if (!_preOnsetMidChecked && (_now - _preOnsetStart) >= VAD_ONSET_SUSTAIN_MS * 0.5) {
                                // Mid-window spectral re-check (~125ms in): a second desk-tap mid-window
                                // shifts energy to LF-broadband — a re-check here catches it before the
                                // sustain window confirms. Runs once per pre-onset window.
                                var _sr2 = (audioAnalyser.context && audioAnalyser.context.sampleRate) || 48000;
                                var _mb2Start = Math.ceil(300 * audioAnalyser.fftSize / _sr2);
                                var _mb2End   = Math.floor(3500 * audioAnalyser.fftSize / _sr2);
                                var _mb2Sum = 0, _tot2Sum = 1;
                                for (var _si2 = 0; _si2 < buf.length; _si2++) { _tot2Sum += buf[_si2]; if (_si2 >= _mb2Start && _si2 <= _mb2End) _mb2Sum += buf[_si2]; }
                                if (_mb2Sum / _tot2Sum >= VAD_VOICE_BAND_FRAC) {
                                    _preOnsetMidChecked = true;  // mid-window passed; continue accumulating
                                } else {
                                    _rejectedTransients++; _lastRejectReason = 'spec'; _preOnsetStart = 0; _preOnsetMidChecked = false;  // broadband double-tap mid-window — abort onset
                                }
                            }
                            // else: accumulating within the sustain window
                            _preOnsetDipStart = 0;  // S154: above-threshold frame ends any tolerated dip
                        }
                        // else: voice with no preceding in-window silence (carry-over) → ignore
                    } else {
                        voiced++;   // continuing run (a brief dip < DIGIT_VOICE_GAP_MS was tolerated)
                        if (rms < voiceMin) voiceMin = rms;
                        if (rms > voiceMax) voiceMax = rms;
                    }
                    _voiceDipStart = 0;   // above-speech now → not dipping
                    // FIRE only once the window is open AND the run is CONTINUOUSLY SUSTAINED
                    // (>=DIGIT_VOICE_MIN_MS, time-based — display-cadence-independent) and MODULATED —
                    // so a ~100ms tap (too short) or spaced taps (run keeps restarting) or a flat
                    // beep/tone (no modulation) can't satisfy a digit, while a real spoken number does.
                    if (voiced > 0 && _now >= speechWindowStart
                        && (_now - _voiceOnsetAt) >= DIGIT_VOICE_MIN_MS
                        && (voiceMax - voiceMin) >= Math.max(0.012, 0.10 * voiceMax)
                        && _voicedAboveThrFrames >= VOICE_EVIDENCE_MIN_FRAMES) {
                        // S154 DATA-DRIVEN (vad_gate telemetry, Rob live test 14:15-14:16 UTC):
                        // every failed digit passed duration+level and failed the ABSOLUTE 0.030
                        // modulation floor — normal steady speech at peak ~0.21 swings 0.020-0.026.
                        // Relative floor: 10% of the run's own peak (min 0.012). His 0.020 swing at
                        // 0.194 peak now passes (needs 0.019); a flat tone at any level still fails
                        // (~zero swing); the voice-band + dual spectral checks + Gemini remain the
                        // real anti-spoof per L-2439 (client gates are pacing aids).
                        _vadDiag('FIRED: ' + Math.round(_now - _voiceOnsetAt) + 'ms pk ' + ((voiceMax)*100).toFixed(0) + '% thr ' + (vadSpeechThreshold*100).toFixed(0) + '%'); try { vacDebug('vad_gate', 'fired', { path:'full', content_gated: _sessionGateAvail, dur_ms: Math.round(_now - _voiceOnsetAt), peak: Number((voiceMax).toFixed(3)), thr: Number(vadSpeechThreshold.toFixed(3)), digit_index: currentDigitIndex }); } catch(_){}  // S154 diag
                        // D-VOICE-GATE-SPEAKER-AGNOSTIC: energy alone is NOT a progression signal.
                        // When content gate is available, mark mic health and wait for content match.
                        // When unavailable (Firefox), fall back to energy progression (degraded).
                        if (_sessionGateAvail) {
                            _vadEnergyDetected = true;  // mic-health indicator only
                            _refreshContentGate();      // ensure content gate is running for this digit
                        } else {
                            _markSpeech('vad', rms, _voiceOnsetAt);  // energy fallback
                        }
                        voiced = 0; voiceMin = 1; voiceMax = 0; _sawSilence = false; _voicedAboveThrFrames = 0;   // consumed; a NEW silence is required to re-arm
                    }
                } else {
                    // neither band (between silence and speech thresholds)
                    // S154 FIX (telemetry: dur-366/mod-.023 runs dying unfired): a run whose
                    // duration+modulation conditions become satisfied while the level sits in a
                    // dip frame previously never fired — the check lived only in the above-
                    // threshold branch. Evaluate on run-alive dip frames too; same conditions,
                    // no loosening.
                    if (voiced > 0 && _now >= speechWindowStart
                        && (_now - _voiceOnsetAt) >= DIGIT_VOICE_MIN_MS
                        && (voiceMax - voiceMin) >= Math.max(0.012, 0.10 * voiceMax)
                        && _voicedAboveThrFrames >= VOICE_EVIDENCE_MIN_FRAMES) {
                        _vadDiag('FIRED(dip): ' + Math.round(_now - _voiceOnsetAt) + 'ms pk ' + ((voiceMax)*100).toFixed(0) + '% thr ' + (vadSpeechThreshold*100).toFixed(0) + '%'); try { vacDebug('vad_gate', 'fired', { path:'full', on:'dip', content_gated: _sessionGateAvail, dur_ms: Math.round(_now - _voiceOnsetAt), peak: Number((voiceMax).toFixed(3)), thr: Number(vadSpeechThreshold.toFixed(3)), digit_index: currentDigitIndex }); } catch(_){}
                        if (_sessionGateAvail) {
                            _vadEnergyDetected = true;
                            _refreshContentGate();
                        } else {
                            _markSpeech('vad', voiceMax, _voiceOnsetAt);
                        }
                        voiced = 0; voiceMin = 1; voiceMax = 0; _sawSilence = false; _voicedAboveThrFrames = 0;
                    }
                    if (_preOnsetStart) {  // S154: tolerate brief observed dips (soft consonants) within pre-onset; only a SUSTAINED dip (> VAD_ONSET_DIP_MS) aborts — was a hard single-frame reset that rejected normal speech
                        if (_preOnsetDipStart === 0) _preOnsetDipStart = _now;
                        else if (_now - _preOnsetDipStart > VAD_ONSET_DIP_MS) { _rejectedTransients++; _lastRejectReason = 'sust'; _vadDiag('onset aborted: dip > ' + VAD_ONSET_DIP_MS + 'ms during sustain (had ' + Math.round(_now - _preOnsetStart) + 'ms of ' + VAD_ONSET_SUSTAIN_MS + 'ms)'); try { vacDebug('vad_gate', 'onset_abort_dip', { path:'full', had_ms: Math.round(_now - _preOnsetStart), need_ms: VAD_ONSET_SUSTAIN_MS }); } catch(_){} _preOnsetStart = 0; _preOnsetMidChecked = false; _preOnsetDipStart = 0; }
                    }
                    if (voiced > 0) {
                        // mid-run dip: time it; if it stays here past DIGIT_VOICE_GAP_MS the voicing
                        // wasn't continuous (spaced taps in elevated ambient) → KILL the run. Re-arming
                        // then needs a real silence→voice onset (_sawSilence guard above), NOT a re-onset
                        // here — so taps can't accumulate and the fresh-silence per-digit binding holds.
                        // _sawSilence is left untouched (a neither-band dip is not a real pause).
                        // rAF jank observes no neither frames, so it can't trip this — a real digit survives.
                        if (!_voiceDipStart) _voiceDipStart = _now;
                        else if (_now - _voiceDipStart > DIGIT_VOICE_GAP_MS) { voiced = 0; voiceMin = 1; voiceMax = 0; _voiceDipStart = 0; _voicedAboveThrFrames = 0; }
                    }
                }
                _lastVoiceMs = (voiced > 0) ? Math.round(_now - _voiceOnsetAt) : 0;   // R1: surface continuous voiced-run ms to ?qa=1
            } catch(_) {}
            _vadRAF = requestAnimationFrame(tick);
        })();
    }
    function _speechGateOff(reason) {
        try { window.__vacGateArmed = false; var _mf0 = document.getElementById('avMicBarFill'); if (_mf0) _mf0.style.width = '0%'; var _sv0 = document.getElementById('vacStepVU'); if (_sv0) _sv0.remove(); } catch(_) {}
        _speechMode = 'off';           // _speechOk becomes true → gesture-only advance, with a visible note
        _acceptArmed = true;           // Option 2: let the currently-held gesture advance now (escape/degrade), not after a re-show
        if (_vadRAF) { cancelAnimationFrame(_vadRAF); _vadRAF = null; }
        try { vacDebug('speech_gate_mode', null, { mode: 'off', reason: reason || null }); } catch(_) {}
        // F-563 recoverability: a GENUINE no-mic (null analyser) surfaces the recovery panel; a
        // deliberate user-escape ('user_escape') does NOT (the user already chose gesture-only).
        if (reason === 'no_audio_analyser') { try { _showNoMicRecovery(); } catch(_) {} }
    }
    function _stopSpeechGate() {
        if (_vadRAF) { cancelAnimationFrame(_vadRAF); _vadRAF = null; }
        // D-VOICE-GATE-SPEAKER-AGNOSTIC: stop any running content gate
        if (_contentGate) { _contentGate.stop(); _contentGate = null; _contentGateDigit = -1; }
    }
    // Stuck-user escape (D2): gesture held ready but VAD never fires (muted/quiet mic).
    // Explicit tap, never silent auto-advance; turns the voice gate off for THIS digit
    // and the rest of the sequence. Voice gate is pacing only, so this doesn't weaken
    // security (Gemini authoritative).
    function _ensureVoiceEscape() {
        if (document.getElementById('vacVoiceEscape')) return;
        var btn = document.createElement('button');
        btn.id = 'vacVoiceEscape';
        btn.style.cssText = 'display:block;margin:8px auto 0;padding:9px 18px;background:var(--warning,#D29922);color:#0D1117;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer';
        btn.textContent = 'Mic not working? Tap to continue with gestures only';
        if (challengeEl && challengeEl.parentElement) challengeEl.parentElement.appendChild(btn);
        btn.addEventListener('click', function() {
            // F-563: the escape only appears once the gesture is latched (waiting on voice). The user
            // is on the camera-free say step with the hand DOWN — so let THIS digit advance via the
            // latch, then speech-off (live-gesture) governs the remaining digits. Without this, the
            // new speech-off live-gesture rule would strand them (hand down) right after escaping.
            _escapeAdvancePending = _qaGestureLatched;
            _speechGateOff('user_escape');
            try { vacDebug('voice_gate_escape', null, { digit_index: currentDigitIndex }); } catch(_) {}
            _removeVoiceEscape();
        });
    }
    function _removeVoiceEscape() {
        var btn = document.getElementById('vacVoiceEscape');
        if (btn) btn.remove();
    }
    function _renderVoiceOffNote() {
        var note = document.getElementById('vacVoiceOff');
        if (_speechMode === 'off') {
            if (!note) {
                note = document.createElement('div');
                note.id = 'vacVoiceOff';
                note.style.cssText = 'text-align:center;margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--text-tertiary);letter-spacing:0.5px';
                note.textContent = '(voice gate off)';
                if (challengeEl && challengeEl.parentElement) challengeEl.parentElement.appendChild(note);
            }
        } else if (note) { note.remove(); }
    }

    // Timer fallback — used if HandLandmarker unavailable or too slow. Respects SPEED_CONFIG.digit.
    // W4.1 (D-VAC-GESTURE-REALTIME-DETECTION): the OLD fallback auto-advanced
    // through digits on a clock regardless of what the user showed — the bug Rob
    // hit (timer marched 1→3 without detecting). NEW behaviour: detection is the
    // ONLY thing that advances a step. When MediaPipe is unavailable we do NOT
    // silently auto-advance; we show an explicit status so the user knows the
    // camera detector isn't running, and we hold the current step. The timer is
    // a per-step TIMEOUT hint, never an auto-advance.
    function runTimerFallback() {
        try { var _gp=document.getElementById('vacGuided'); if(_gp) _gp.style.display='none'; } catch(_) {}  // F-563 (2): the guided detection panel doesn't apply to the manual fallback — hide it
        try { var _sv=document.getElementById('vacSayView'); if(_sv) _sv.style.display='none'; } catch(_) {}  // F-563 (latch): no camera-free say-step in the manual fallback
        try { _stopSpeechGate(); } catch(_) {}  // F-561: no gesture detection here → voice gate doesn't apply (manual advance only)
        try { vacDebug('phase2_timer_fallback_no_autoadvance', null, { digit_duration_s: DIGIT_DURATION, digits_count: digits.length }); } catch(_) {}
        console.log('[VAC] Finger phase: detector unavailable — holding for user, NOT auto-advancing (W4.1)');
        // W4.1 fix: remove the detection-path status element so the two UIs don't
        // render simultaneously (the collision Rob's screenshot showed).
        var _ld = document.getElementById('vacLiveDetect');
        if (_ld) _ld.remove();
        // Visible status so Rob/users immediately know detection isn't running.
        var statusEl = document.getElementById('vacDetectStatus');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'vacDetectStatus';
            statusEl.style.cssText = 'text-align:center;margin-top:8px;font-family:var(--mono);font-size:12px;letter-spacing:0.5px';
            if (challengeEl && challengeEl.parentElement) challengeEl.parentElement.appendChild(statusEl);
        }
        statusEl.style.color = '#fbbf24';
        statusEl.textContent = 'Camera detector unavailable — show AND SAY each number out loud, then tap to advance (your spoken numbers are still recorded for verification)';
        CaptureFeedback.renderFingerPhase(ctx, false, currentDigitIndex);

        // Per-step MANUAL advance (no auto-advance). User taps to confirm each
        // gesture is held. This is the safety net when detection is down — it
        // never marches ahead on its own.
        function ensureAdvanceButton() {
            var btn = document.getElementById('vacManualAdvance');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'vacManualAdvance';
                btn.style.cssText = 'display:block;margin:10px auto 0;padding:10px 22px;background:var(--purple,#7c5cfc);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer';
                btn.textContent = 'Shown + said it ✓ — next';
                if (challengeEl && challengeEl.parentElement) challengeEl.parentElement.appendChild(btn);
                btn.addEventListener('click', function() {
                    if (recordingStopped) return;
                    // record that the user confirmed this position (count unknown
                    // without detection — server-side Gemini remains the trust gate
                    // on the recorded video; this only drives UI progression).
                    detectedDigits[currentDigitIndex] = true;
                    currentDigitIndex++;
                    if (currentDigitIndex >= digits.length) {
                        btn.remove();
                        if (statusEl) statusEl.remove();
                        CaptureFeedback.renderFingerPhase(ctx, false, currentDigitIndex);
                        finishFingerPhase();
                    } else {
                        // S111 #3: the per-step numbers now live ONLY in #digitStrip (the in-frame
                        // circles were removed), so the manual fallback must advance the strip too —
                        // else it sticks on the first digit and the user shows the wrong sequence (codex).
                        try { CaptureFeedback.renderDigitStrip(ctx, currentDigitIndex); } catch(_) {}
                        CaptureFeedback.renderFingerPhase(ctx, false, currentDigitIndex);
                    }
                });
            }
            btn.textContent = (currentDigitIndex >= digits.length - 1) ? 'Shown + said it ✓ — finish' : 'Shown + said it ✓ — next';
        }
        ensureAdvanceButton();

        // Keep the ring ticking purely as a visual (does NOT advance steps).
        let fallbackElapsed = 0;
        const fallbackInterval = setInterval(function() {
            if (recordingStopped) { clearInterval(fallbackInterval); return; }
            fallbackElapsed += 0.2;
            const totalElapsed = PHRASE_DURATION + fallbackElapsed;
            ringFill.style.strokeDashoffset = circumference * Math.min(totalElapsed / totalDuration, 1);
            timerEl.textContent = Math.max(Math.ceil(totalDuration - totalElapsed), 0);
        }, 200);
    }

    // Detection loop (requestAnimationFrame) — advances on ANY finger shown.
    // Server-side Gemini validates the full sequence; this is purely for UX responsiveness.
    // Skeleton overlay (S110, Rob): dots + connector lines on the hand during the finger
    // phase — shows the user the system is tracking them live. Same MediaPipe landmarks
    // already used for counting; purely visual.
    const _HAND_CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

    function _drawHandSkeleton(videoEl, lm, targetN){
        const cv=document.getElementById('handOverlay');
        if(!cv||!videoEl) return;
        if(!cv._ctx) cv._ctx=cv.getContext('2d',{willReadFrequently:false});
        const ctx=cv._ctx;
        if(cv.width!==videoEl.videoWidth){ cv.width=videoEl.videoWidth; cv.height=videoEl.videoHeight; }
        ctx.clearRect(0,0,cv.width,cv.height);
        // F-755: static oval guide only — live skeleton suppressed.
        try { _drawFingerTargetGuide(ctx, cv.width, cv.height, targetN, _guideSide(lm), lm); } catch(_){}
        // F-763 (SECURITY): the client finger count / mic readout is a QA-ONLY debug instrument.
        // Showing real-time fingers:N to a live user hands an attacker a success/fail oracle on the
        // detector (they can tune a spoof until it reads the target) AND exposes the forgeable client
        // count. Gemini is the sole authority server-side, so this never gated the verdict — but it
        // must NOT be visible in production/demo. Gate behind ?qa=1 (QA.on), same as other telemetry.
        try {
          if (typeof QA !== 'undefined' && QA && QA.on) {
            var _rmsVal = _lastVadRms;
            var _vbVal = _lastVbRatio;  // BUILD 379
            var _gate = (_rmsVal > vadSpeechThreshold && _vbVal >= VOICE_BAND_MIN_RATIO) ? 'voiced'
                      : (_rmsVal < vadSilenceThreshold) ? 'silent' : 'neither';
            var _cliN = (typeof _lastDetectedCount !== 'undefined' && _lastDetectedCount != null) ? _lastDetectedCount : '-';
            var _preMs = (typeof _preOnsetStart !== 'undefined' && _preOnsetStart) ? Math.round(performance.now() - _preOnsetStart) : 0;
            var _rejN = (typeof _rejectedTransients !== 'undefined') ? _rejectedTransients : 0;
            var _rejReason = (typeof _lastRejectReason !== 'undefined' && _lastRejectReason) ? '(' + _lastRejectReason + ')' : '';
            var _rmsText = 'fingers:' + _cliN + '  mic:' + _rmsVal.toFixed(3) + '  vb:' + _vbVal.toFixed(2) + '  gate:' + _gate + (_preMs ? '  pre:' + _preMs + 'ms' : '') + '  rejTap:' + _rejN + _rejReason;
            var _rfsz = Math.max(15, Math.round(cv.width * 0.030));
            ctx.save();
            // counter-flip: cancel the canvas scaleX(-1) so text reads forward
            ctx.translate(cv.width, 0); ctx.scale(-1, 1);
            ctx.font = 'bold ' + _rfsz + 'px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            var _rtw = ctx.measureText(_rmsText).width;
            var _rpad = 7;
            ctx.fillStyle = 'rgba(0,0,0,0.72)';
            ctx.fillRect(8, cv.height - _rfsz - _rpad * 2, _rtw + _rpad * 2, _rfsz + _rpad * 2);
            ctx.fillStyle = (_gate === 'voiced') ? '#8B7CF7' : (_gate === 'silent') ? '#cccccc' : '#F4D03F';
            ctx.fillText(_rmsText, 8 + _rpad, cv.height - _rpad);
            ctx.restore();
          }
        } catch(_) {}
    }

    let _detLoopFrames = 0;  // telemetry only
    let _handZoneLastState = null;  // task-432 Part 4: transition telemetry — null until first classified frame
    let _handZoneSnapLastT = 0;    // task-handzone-faceanchored: throttle per-beat zone snapshot (2s interval)
    function runDetectionLoop() {
        if (recordingStopped) return;
        const videoEl = document.getElementById('videoPreviewRec');
        try { _maybeUpdateFaceAnchor(videoEl); } catch(_) {}   // task-432 Part 1: throttled face-anchor refresh
        const detected = FingerDetector.detect(videoEl);
        try { _lastDetectedCount = detected; } catch(_){}
        // F-613: smoothed count for STABILITY/TIMING only (absorbs MediaPipe flicker
        // so a steady hold isn't broken by a stray frame — fixes "had to hold still").
        // The RAW `detected` is still what we RECORD + send to the server (capture-on-
        // stale guard: never let the smoothed value become the value-of-record; Gemini
        // is the real gate). feedStable reuses the raw value — no second MediaPipe run.
        var _stableDetected = FingerDetector.feedStable(detected);
        if (_stableDetected === null || _stableDetected === undefined) _stableDetected = detected;
        _drawHandSkeleton(videoEl, FingerDetector.landmarks, digits[currentDigitIndex]);
        // Hand presence + near-face zone (advisory feedback only; server still gates).
        // detected === -1 means no hand in frame; landmarks null otherwise.
        var _handPresent = !!FingerDetector.landmarks;
        var _handNear = _handPresent && _handNearFaceZone(FingerDetector.landmarks);
        // task-432 Part 4: throttled hand_zone in/out telemetry (transition-only, no per-frame spam).
        try { _handZoneLastState = _noteHandZoneTransition(_handZoneLastState, _handNear, _activeZone()); } catch(_) {}
        // task-handzone-faceanchored: per-beat zone snapshot — fires ~every 2s with face-anchored
        // zone bounds + palm position + zone membership, so a stuck digit is diagnosable server-side
        // without requiring QA mode. Complements the transition-only hand_zone event above.
        try {
            var _snapNow = performance.now();
            if (_snapNow - _handZoneSnapLastT >= 2000) {
                _handZoneSnapLastT = _snapNow;
                var _snapZone = _activeZone();
                var _snapLm = FingerDetector.landmarks;
                var _snapPcx = null, _snapPcy = null, _snapPalmIn = null, _snapTips = 0;
                if (_snapLm && _snapLm.length === 21) {
                    var _sfin = true;
                    for (var _sfi = 0; _sfi < 21 && _sfin; _sfi++) { if (!_snapLm[_sfi] || !Number.isFinite(_snapLm[_sfi].x) || !Number.isFinite(_snapLm[_sfi].y)) _sfin = false; }
                    if (_sfin) {
                        var _spc = { x: (_snapLm[5].x + _snapLm[9].x + _snapLm[13].x + _snapLm[17].x) / 4, y: (_snapLm[5].y + _snapLm[9].y + _snapLm[13].y + _snapLm[17].y) / 4 };
                        _snapPcx = +_spc.x.toFixed(3); _snapPcy = +_spc.y.toFixed(3);
                        _snapPalmIn = _ptInCheekZone(_spc);
                        var _stips = [4, 8, 12, 16, 20];
                        for (var _sti = 0; _sti < _stips.length; _sti++) { if (_ptInCheekZone(_snapLm[_stips[_sti]])) _snapTips++; }
                    }
                }
                vacDebug('hand_zone_snap', null, {
                    digit_index: currentDigitIndex,
                    anchored: _snapZone.anchored,
                    rx: +_snapZone.rx.toFixed(3),
                    ry: +_snapZone.ry.toFixed(3),
                    ovals: _snapZone.ovals.map(function(o) { return { side: o.side, cx: +o.cx.toFixed(3), cy: +o.cy.toFixed(3) }; }),
                    palm_cx: _snapPcx,
                    palm_cy: _snapPcy,
                    palm_in_zone: _snapPalmIn,
                    tips_in: _snapTips,
                    hand_near: _handNear
                });
            }
        } catch(_) {}
        // F-755: per-frame instrumentation (advisory; never fed to server clip).
        try {
            var _f755lm = FingerDetector.landmarks;
            var _f755count = _f755lm ? _f755lm.length : 0;
            var _f755confident = false;
            if (_f755lm && _f755count === 21) {
                var _f755fin = true;
                for (var _f755i = 0; _f755i < 21 && _f755fin; _f755i++) {
                    if (!_f755lm[_f755i] || !Number.isFinite(_f755lm[_f755i].x) || !Number.isFinite(_f755lm[_f755i].y)) _f755fin = false;
                }
                if (_f755fin) _f755confident = _handNear;
            }
            console.debug('[VAC-DBG] f755_frame', { landmark_count: _f755count, hand_near_face: _handNear, confident: _f755confident });
        } catch(_) {}
        try {
            var _camBox = document.getElementById('cameraBoxRec');
            _camBox.classList.toggle('hand-visible', _handPresent);
            // Defense-in-depth (S120): NEVER reveal the hand-zone apparatus for a fast still
            // (capture.kind==='still') — it would hide #faceOval (CSS .show-hand-zone .face-oval
            // {display:none}) and show the dotted hand oval. This loop is full/clip-only at
            // runtime (startCountdown routes fast -> beginStillCapture, not beginRecording), so
            // this guard is belt-and-suspenders against a future fast caller. FULL: unchanged.
            if (modeConfig().capture.kind !== 'still') _camBox.classList.add('show-hand-zone');   // reveal the hand guide during the gesture step
            _camBox.classList.toggle('hand-in-zone', _handNear);     // green when the hand reaches the near-face zone
        } catch(_){}
        // S110: hand-too-close / partially-out-of-frame guard (Rob — last digit
        // failed until he pulled his hand back so the whole hand was in frame).
        // MediaPipe needs all 21 landmarks visible to count reliably; if the hand
        // is clipped at an edge or fills the frame, prompt the user to pull back.
        try { CaptureFeedback.checkHandFraming(ctx, FingerDetector.landmarks); } catch(_){}
        _detLoopFrames++;
        if (_detLoopFrames === 1) {
            try { vacDebug('detect_loop_first_frame', null, { detected: detected, video_ready: (videoEl && videoEl.readyState) || null }); } catch(_) {}
        }

        if (FingerDetector.failed) {
            try { vacDebug('detect_loop_to_fallback', 'FingerDetector.failed became true during loop', { frames: _detLoopFrames }); } catch(_) {}
            runTimerFallback();
            return;
        }

        // W4.1 HAND-STAYS-UP model (Rob): the user keeps their hand up the whole
        // time and just CHANGES the number of fingers for each digit. We advance
        // when a count is held STABLE for ~0.6s AND it differs from the last count
        // we accepted. No "drop your hand between numbers" — the CHANGE is the gate.
        // Note: we only need to detect that a DISTINCT stable gesture was held; the
        // ACTUAL finger count is validated later server-side by Gemini (Rob's point).
        if (detected > 0) {
            _releaseFrames = 0; _releaseSince = 0;   // hand present — reset the sustained-release counter + timer
            // F-613: track stability on the SMOOTHED count (_stableDetected), so a stray
            // flicker frame no longer resets the hold timer. The user can hold a count
            // naturally; a 1-frame miscount is absorbed by the detector's hysteresis.
            if (_stableDetected === stableCount) {
                stableFrames++;
            } else {
                // Smoothed count changed — restart the hold timer. digitStartTime resets on
                // ANY change so the dwell always measures the CURRENT continuous hold (S110
                // racing fix, change-agnostic so repeated digits re-time cleanly too).
                stableCount = _stableDetected;
                stableFrames = 1;
                digitStartTime = performance.now();
            }
            // Speech-off re-arm: a count DIFFERENT from the last accepted, held STABLY, is a
            // deliberate new gesture — robust to transient miscounts (a 1-frame flicker never
            // reaches STABLE_FRAMES_NEEDED). A repeated digit (same count) re-arms via a
            // sustained release instead (codex P2).
            if (!_acceptArmed && _stableDetected !== _lastAcceptedCount && stableFrames >= STABLE_FRAMES_NEEDED) { _acceptArmed = true; }
            // Accept when held steady long enough (+ the AND-gate's speech / re-arm below).
            // S110 sync fix: require a wall-clock minimum dwell (MIN_DIGIT_DWELL_MS) since at
            // 60fps STABLE_FRAMES_NEEDED=12 is only ~0.2s — too fast for the recorded video to
            // capture each pose, so Gemini saw only the first digit.
            const _nowMs = performance.now();
            if (digitStartTime === 0) digitStartTime = _nowMs;  // first digit: start the dwell clock on first stable detection
            const _dwellOk = (_nowMs - digitStartTime) >= MIN_DIGIT_DWELL_MS;
            // F-561 Option 2 (S111): _gestureOk is just "held steady long enough" — the
            // count-change guard (detected !== lastAcceptedCount) is GONE, so a repeated
            // digit ([2,4,4]) is solvable. The per-digit SPEECH window is the new-digit signal.
            const _gestureOk = stableFrames >= STABLE_FRAMES_NEEDED && _dwellOk;
            // F-563: the actual ADVANCE (gesture-latched || live) AND speech AND re-arm is now
            // evaluated at FRAME level after this if/else, so it also fires with the hand DOWN
            // (camera-free "Say N" step). Here we only DETECT + LATCH the gesture for this digit.
            const _speechOk = (_speechMode === 'off') ? true : speechReady[currentDigitIndex];  // for the QA live line
            // F-560: record gesture-confirmed-at once per digit, independent of advance,
            // so the overlay shows the gesture→speech→advance gap. Also starts the
            // stuck-user escape timer (gesture ready, waiting on voice).
            // F-563: the latch must reflect a FRESH gesture for THIS digit, because the say-view
            // treats _qaGestureLatched as "gesture done" and hides the camera. Gate it on BOTH:
            //  - after the confirm beat (_nowMs >= _confirmUntil), and
            //  - _acceptArmed — the re-arm signal (a stably-held DISTINCT count, or a sustained
            //    release + re-show). A previous pose merely HELD through the beat keeps _acceptArmed
            //    false (same count, no release), so it can't latch the next digit and pre-hide the
            //    camera / record the stale count (codex P1). This makes the latch genuinely per-digit.
            if (_gestureOk && !_qaGestureLatched && _nowMs >= _confirmUntil && _acceptArmed) {
                _qaGestureLatched = true;
                if (!_gestureReadyAt) _gestureReadyAt = _nowMs;   // don't reset the voice-wait timer if it already started at held-ready (below)
                _latchedCount = detected;     // capture the SHOWN count now — the hand may be down by advance time (camera-free say step)
                _latchedFrames = stableFrames;
                // F-563 note: we deliberately do NOT reset speechReady here. If the user said the
                // number WHILE showing (the old natural way), that is a real fresh onset in THIS
                // digit's window (binding intact — not pre-satisfaction), so the digit just completes
                // and the say-screen is skipped (an experienced-user fast path). Resetting it to force
                // strict show→say sequencing would discard the utterance that re-arms a held repeated
                // digit ([2,4,4]) via _markSpeech, breaking that flow (codex). The say-screen still
                // appears for everyone who shows the gesture before speaking — the common case.
                try { vacDebug('gesture_confirm', null, { digit_index: currentDigitIndex, count: detected }); } catch(_) {}
            }
            if (QA.on) { try { QA.frame({ detected: detected, stableFrames: stableFrames, need: STABLE_FRAMES_NEEDED, dwellMs: Math.round(_nowMs - digitStartTime), beatMs: Math.max(0, Math.round(_confirmUntil - _nowMs)), gestureOk: _gestureOk, speechOk: _speechOk, rms: (_speechMode === 'vad' ? _lastVadRms : null), thr: vadSpeechThreshold, voiceMs: (_speechMode === 'vad' ? _lastVoiceMs : null), voiceNeed: DIGIT_VOICE_MIN_MS }); } catch(_) {} }
            // F-563: advance is evaluated at FRAME level (after this if/else), NOT here — because
            // the camera-free "Say N" step has the hand DOWN (detected===0), and an advance gated
            // inside `if (detected>0)` would deadlock once the gesture is latched + voice given
            // (codex P1). The latch (_qaGestureLatched) already captures "gesture confirmed".
        } else {
            // Hand fully dropped — reset the hold. A SUSTAINED release re-arms the speech-off path
            // so a repeated digit can be shown again (Option 2 / codex P2). Harmless in VAD mode
            // (ignores _acceptArmed). S155 Schmitt trigger: BOTH a frame-count floor (robust to
            // 1-frame detection dropouts, raised 1.3x per the positive-evidence floor) AND a
            // wall-clock sustain floor (fps-independent) must be satisfied — release can only get
            // SLOWER than the old frame-only check, never faster.
            _releaseFrames++;
            if (!_releaseSince) _releaseSince = performance.now();
            if (_releaseFrames >= FINGER_RELEASE_MIN_FRAMES && (performance.now() - _releaseSince) >= FINGER_RELEASE_SUSTAIN_MS) _acceptArmed = true;
            stableCount = 0;
            stableFrames = 0;
            if (QA.on) { try { QA.frame({ detected: 0, stableFrames: 0, need: STABLE_FRAMES_NEEDED, dwellMs: digitStartTime ? Math.round(performance.now() - digitStartTime) : 0, beatMs: Math.max(0, Math.round(_confirmUntil - performance.now())), gestureOk: false, speechOk: (_speechMode === 'off') ? true : speechReady[currentDigitIndex], rms: (_speechMode === 'vad' ? _lastVadRms : null), thr: vadSpeechThreshold, voiceMs: (_speechMode === 'vad' ? _lastVoiceMs : null), voiceNeed: DIGIT_VOICE_MIN_MS }); } catch(_) {} }
        }

        // F-563: FRAME-LEVEL advance — fires whether the hand is UP or DOWN, so the camera-free
        // "Say N" step (hand down) can complete the digit (codex P1: gating advance inside
        // `if (detected>0)` deadlocked it). The cross-modal binding is fully preserved:
        //   - _qaGestureLatched = gesture confirmed for THIS digit (set the same frame the live
        //     gesture first went ready; RESET on advance below → digit N+1 needs a FRESH gesture).
        //   - speechReady[i] = a FRESH per-digit silence→voice onset (untouched by the latch).
        //   - _acceptArmed still guards a stale carried-over pose / double-accept.
        // The count RECORDED is _latchedCount (captured when the gesture latched) — not `detected`,
        // which is 0 once the hand is down for the say step.
        // SHOW-AS-YOU-SAY: a digit advances only when a LIVE gesture (fingers up & stable NOW) and a
        // sustained-voice fire CO-OCCUR — fingers are up AT the spoken timestamp (one continuous take →
        // stronger Gemini temporal binding). No more camera-free hand-down "say" step.
        var _liveGestureOk = (detected > 0 && stableFrames >= STABLE_FRAMES_NEEDED && digitStartTime > 0 && (performance.now() - digitStartTime) >= MIN_DIGIT_DWELL_MS);
        var _nowCo = performance.now();
        // F-662: expiry + advance are now the SHARED _cooccurAdvanceDecision (the FAST tier reuses the
        // identical timing). Semantics UNCHANGED — a stale armed voice expires ONLY while the hand is
        // genuinely DOWN (detected===0) past DIGIT_COOCCUR_MS (a voice-led user whose hand is up and
        // merely settling does NOT expire → no livelock, adversarial-review F1), plus the absolute
        // DIGIT_COOCCUR_MAX_MS cap; then advance on a live (stable, held) gesture AND still-armed voice
        // co-occurring. speech-off (no mic) stays gesture-only + _acceptArmed re-arm, as before.
        var _coDecision = _cooccurAdvanceDecision({
            speechMode: _speechMode,
            voiceArmed: speechReady[currentDigitIndex],
            voiceFiredAt: _voiceFiredAt,
            liveGestureOk: _liveGestureOk,
            now: _nowCo,
            handDown: (detected === 0),
            escapePending: _escapeAdvancePending
        });
        if (_coDecision.expireVoice) {
            speechReady[currentDigitIndex] = false;   // F-599: do NOT also clear _voiceFiredAt here — the coaching classifier reads _voiceFiredAt>0 (survives expiry, cleared only on advance @ the _voiceFiredAt=0 line) to know voice fired this digit. Clearing it here would silently kill the near-miss/voice-only hints.
            try { vacDebug('speech_cooccur_expired', null, { digit_index: currentDigitIndex, since_ms: Math.round(_nowCo - _voiceFiredAt) }); } catch(_) {}
        }
        var _advanceNow = _coDecision.advance;
        // S429: per-beat QA instrumentation ONLY — logs what the gate above already decided,
        // decides nothing itself. Surfaces voiced-run duration, co-occurrence window state, client
        // finger count, and the REASON for non-advance so a repeated-digit run (transcript said the
        // same number 3x, fingers only ever showed 2 of the 3 challenge digits) is diagnosable from
        // the log instead of reconstructed after the fact. Throttled to once per reason-change or
        // 300ms so it reads as a beat cadence, not per-rAF-frame spam.
        if (QA.on) {
            try {
                var _coWindowState = (_speechMode === 'off') ? 'off'
                    : (!_voiceFiredAt) ? 'not_fired'
                    : _coDecision.expireVoice ? 'expired_' + Math.round(_nowCo - _voiceFiredAt) + 'ms'
                    : speechReady[currentDigitIndex] ? 'armed_' + Math.round(_nowCo - _voiceFiredAt) + 'ms'
                    : 'consumed';
                var _beatReason = _coDecision.reason;
                if (_beatReason !== _qaBeatLastReason || (_nowCo - _qaBeatLastLogT) >= 300) {
                    _qaBeatLastLogT = _nowCo;
                    _qaBeatLastReason = _beatReason;
                    // S151 fix (Rob: "can't you get the reason yourself from your sensory?"):
                    // console.log alone made Rob the log-reader. vacDebug POSTs to /v1/auth/debug,
                    // so chat-Claude reads the beat trail server-side after a live run — same
                    // throttle (reason-change or 300ms) keeps volume sane. Best-effort, never blocks.
                    vacDebug('digit_beat', _beatReason, {
                        digit_index: currentDigitIndex,
                        voice_ms: _lastVoiceMs,               // R1: continuous voiced-run duration
                        co_window: _coWindowState,             // co-occurrence window state
                        finger_count: detected                 // client-detected finger count this frame
                    });
                }
            } catch(_) {}
        }
        if (currentDigitIndex < digits.length && _advanceNow && _acceptArmed && performance.now() >= _confirmUntil) {
            _escapeAdvancePending = false;
            var _adNow = performance.now();
            // Count to record: the LATCHED count when latched (VAD say-step / normal — hand may be
            // down). On the speech-off LIVE path the latch may not have set this frame (its beat-guard
            // used the earlier _nowMs while this advance's fresh now crossed the beat boundary — codex),
            // so fall back to the live `detected` (that path requires detected>0, so it's valid; never 0).
            // SHOW-AS-YOU-SAY: fingers are UP at co-occurrence, so record the LIVE detected count
            // (the count on camera at the spoken timestamp), not a possibly-stale latched count.
            var _recordCount = detected || _latchedCount;
            var _recordFrames = stableFrames || _latchedFrames;
            if (currentDigitIndex === 0) {
                try { vacDebug('detect_first_finger_advance', null, { frames_before_first_detect: _detLoopFrames, fingers_shown: _recordCount, held_frames: _recordFrames }); } catch(_) {}
            }
            // task-handzone-faceanchored: include face-anchored zone geometry at advance time so
            // Rob can confirm the zone was beside the actual cheek when each pose was accepted.
            try {
                var _advZone = _activeZone();
                var _advLm = (typeof FingerDetector !== 'undefined') ? FingerDetector.landmarks : null;
                var _advPcx = null, _advPcy = null, _advPalmIn = null, _advTips = 0;
                if (_advLm && _advLm.length === 21) {
                    var _afin = true;
                    for (var _afi = 0; _afi < 21 && _afin; _afi++) { if (!_advLm[_afi] || !Number.isFinite(_advLm[_afi].x) || !Number.isFinite(_advLm[_afi].y)) _afin = false; }
                    if (_afin) {
                        var _apc = { x: (_advLm[5].x + _advLm[9].x + _advLm[13].x + _advLm[17].x) / 4, y: (_advLm[5].y + _advLm[9].y + _advLm[13].y + _advLm[17].y) / 4 };
                        _advPcx = +_apc.x.toFixed(3); _advPcy = +_apc.y.toFixed(3);
                        _advPalmIn = _ptInCheekZone(_apc);
                        var _atips = [4, 8, 12, 16, 20];
                        for (var _ati = 0; _ati < _atips.length; _ati++) { if (_ptInCheekZone(_advLm[_atips[_ati]])) _advTips++; }
                    }
                }
                vacDebug('detect_digit_advance', null, {
                    digit_index: currentDigitIndex,
                    fingers_shown: _recordCount,
                    held_frames: _recordFrames,
                    dwell_ms: Math.round(_adNow - digitStartTime),
                    zone_anchored: _advZone.anchored,
                    zone_rx: +_advZone.rx.toFixed(3),
                    zone_ry: +_advZone.ry.toFixed(3),
                    zone_ovals: _advZone.ovals.map(function(o) { return { side: o.side, cx: +o.cx.toFixed(3), cy: +o.cy.toFixed(3) }; }),
                    palm_cx: _advPcx,
                    palm_cy: _advPcy,
                    palm_in_zone: _advPalmIn,
                    tip_count_in_zone: _advTips
                });
            } catch(_) {}
            detectedDigits[currentDigitIndex] = true;
            detectedCounts[currentDigitIndex] = _recordCount;   // latched count, or live count on the speech-off path — never the hand-down 0
            // F-GESTURE-ZONE-QUALIFIES-POSE: capture whether THIS accepted pose was in-zone, using
            // the SAME hand-near-face/dotted-guide geometry as the live framing guard (_handNear /
            // _handNearFaceZone). Tri-state, computed fresh from the advance frame's landmarks:
            //   landmarks present       → true/false from _handNearFaceZone (the existing zone def)
            //   landmarks missing/short → null (sensor gap) — NEVER false, so a sensor hiccup can't
            //                             drop a legit pose (the backend treats null as "keep").
            // detected>0 is required to reach this advance, so a hand IS present here in practice;
            // the null branch is the defensive fail-safe. Pushed (not indexed) → 1:1 with the
            // poses that feed detectedCounts, in order, surviving the n>0 filter on the counts.
            (function(){
                var _zlm = (typeof FingerDetector !== 'undefined') ? FingerDetector.landmarks : null;
                // task-432 (codex review round 6): this value can cause the BACKEND to drop the
                // pose, and the ON-SCREEN guide (green/"hand in place") reads off the face-anchored
                // _handNearFaceZone — if the upload only checked the fixed fallback geometry, a
                // pose the user was just shown as ACCEPTED could silently get dropped server-side
                // the moment the two geometries disagree (e.g. a user framed high/low who needs the
                // anchored zone). Accept on EITHER geometry agreeing: this can only ever make MORE
                // poses register true, never fewer, so it can't introduce a new drop — it only
                // closes the gap where the face-anchored accept and the uploaded signal disagreed.
                var _zone = (!_zlm || _zlm.length < 21) ? null : (_handNearFaceZone(_zlm) || _handNearFallbackZone(_zlm));
                window.__vacPoseZones.push(_zone);
            })();
            _acceptArmed = false;
            _lastAcceptedCount = _recordCount;
            stableFrames = 0;
            currentDigitIndex++;
            digitStartTime = _adNow;
            hintShown = false;
            _qaGestureLatched = false;   // RESET — digit N+1's gesture latch starts FRESH (no bleed)
            _gestureReadyAt = 0;
            _latchedCount = 0; _latchedFrames = 0;
            _voiceFiredAt = 0;   // SHOW-AS-YOU-SAY (adversarial-review F2): clear the co-occur stamp so digit N+1 can't read a stale value (defensive — speechReady[N+1] already guards, but no stale timestamp should linger)
            if (currentDigitIndex < digits.length) {
                speechWindowStart = performance.now() + CONFIRM_BEAT_MS;
                _sawSilence = false;   // fresh in-window silence→voice onset required for the new digit
                try { vacDebug('speech_window_open', null, { digit_index: currentDigitIndex, at_perf: speechWindowStart }); } catch(_) {}
            }
            _confirmUntil = performance.now() + CONFIRM_BEAT_MS;
            _confirmStripPending = currentDigitIndex;
            var _completedFrac = currentDigitIndex / digits.length;
            ringFill.classList.remove('recording');
            ringFill.style.stroke = 'var(--teal)';
            ringFill.style.strokeDashoffset = circumference * (1 - _completedFrac);
            timerEl.style.fontSize = '14px';
            timerEl.textContent = currentDigitIndex + '/' + digits.length;
            if (currentDigitIndex >= digits.length) {
                try { vacDebug('detect_all_digits_complete', null, { frames: _detLoopFrames, counts: detectedCounts }); } catch(_) {}
                CaptureFeedback.renderFingerPhase(ctx, false, currentDigitIndex);
                finishFingerPhase();
                return;
            }
        }

        if (!hintShown && digitStartTime > 0 && (performance.now() - digitStartTime) > HINT_TIMEOUT_MS) {
            hintShown = true;
        }

        // W4.1: real-time detection status — prominent + step-aware so the user
        // always knows which number they're on and whether a hold is registering.
        // Also remove any fallback-path UI so the two don't render together.
        var _fbStatus = document.getElementById('vacDetectStatus');
        if (_fbStatus) _fbStatus.remove();
        var _fbBtn = document.getElementById('vacManualAdvance');
        if (_fbBtn) _fbBtn.remove();
        var liveEl = document.getElementById('vacLiveDetect');
        if (!liveEl) {
            liveEl = document.createElement('div');
            liveEl.id = 'vacLiveDetect';
            liveEl.style.cssText = 'text-align:center;margin-top:10px;font-family:var(--mono);font-size:17px;font-weight:700;letter-spacing:0.5px;min-height:26px;transition:color 0.15s';
            if (challengeEl && challengeEl.parentElement) challengeEl.parentElement.appendChild(liveEl);
        }
        var stepNum = currentDigitIndex + 1;            // 1-based step for progress display
        var _curDigit = digits[currentDigitIndex];      // the ACTUAL digit to show + SAY (NOT the step number) — codex: numbers are out of the phrase now, so the per-digit prompt must name the real digit
        var totalSteps = digits.length;
        var _now = performance.now();
        var inConfirmBeat = _now < _confirmUntil;       // S110: the "Got it ✓" hold between digits
        // When the beat ends, NOW reveal the next number's highlight (delayed from accept).
        if (!inConfirmBeat && _confirmStripPending >= 0) {
            try { CaptureFeedback.renderDigitStrip(ctx, _confirmStripPending); } catch(_) {}
            _confirmStripPending = -1;
        }
        if (currentDigitIndex >= totalSteps) {
            liveEl.style.color = '#22c55e';
            liveEl.textContent = 'All gestures captured \u2713';
        } else if (inConfirmBeat) {
            // Clear, deliberate confirmation moment — big tick, no next number yet.
            liveEl.style.color = '#22c55e';
            liveEl.style.fontSize = '22px';
            liveEl.textContent = '\u2713  Got it';
        } else if (detected > 0) {
            // Option 2: no more "now change" copy \u2014 a repeated digit is held, not changed.
            liveEl.style.fontSize = '17px';
            const pct = Math.min(Math.round((stableFrames / STABLE_FRAMES_NEEDED) * 100), 100);
            const _needSpeech = (_speechMode !== 'off') && !speechReady[currentDigitIndex];
            if (pct >= 100 && !_acceptArmed && !_needSpeech) {
                // S111 unification: LAST-RESORT re-show — only when NOT waiting on voice, i.e.
                // speech-off mode (no VAD re-arm) or genuinely stuck. In VAD mode the spoken
                // number re-arms the gesture (even on a misdetected count), so this rarely fires.
                liveEl.style.color = '#fbbf24';
                liveEl.textContent = 'Lower your hand, then show ' + _curDigit + ' again';
            } else if (_needSpeech) {
                // SHOW-AS-YOU-SAY: fingers are up \u2014 say the number NOW, together (no separate step).
                // The voice must CO-OCCUR with the held gesture, so keep BOTH actions prompted.
                liveEl.style.color = '#fbbf24';
                liveEl.textContent = (_gestureReadyAt && (_now - _gestureReadyAt) > VOICE_HELP_TIMEOUT_MS)
                    ? ('We can\u2019t hear you \u2014 say \u201c' + _curDigit + '\u201d, or tap below')
                    : ('Keep showing ' + _curDigit + ' \u2014 say \u201c' + _curDigit + '\u201d');
            } else {
                liveEl.style.color = pct >= 100 ? '#22c55e' : '#fbbf24';
                liveEl.textContent = pct >= 100
                    ? ('Got it \u2713')
                    : ('Hold steady ' + pct + '%  (' + stepNum + '/' + totalSteps + ')');
            }
        } else {
            liveEl.style.color = 'var(--text-secondary)';
            liveEl.textContent = 'Show ' + _curDigit + ' finger' + (_curDigit === 1 ? '' : 's') + ' AND say \u201c' + _curDigit + '\u201d \u2014 at the same time';
        }

        // F-599: classify the per-digit co-occurrence near-miss from the REAL gate vars (traced, not
        // invented), then debounce so the hint reads as post-attempt coaching.
        //   voice fired THIS digit = _voiceFiredAt > 0 (set in _markSpeech, cleared on advance, NOT on
        //     expiry — so it survives the silent expiry and stays a reliable per-digit signal).
        //   voice still live        = speechReady[currentDigitIndex] (set false the moment co-occur expires).
        //   gesture seen THIS digit = _qaGestureLatched (latched) OR _liveGestureOk (stable+held now).
        // near-miss = said it AND showed it but co-occur EXPIRED (the silent-expiry catch — THE key one).
        // Guarded OFF in speech-off / no-mic mode (no voice gate → never coach about voice). voiceHelp
        // (genuinely-silent mic, handled in renderGuided) still takes priority over these.
        var _coVoiceFired = (_voiceFiredAt > 0);
        var _coGestureSeen = (_qaGestureLatched || _liveGestureOk);
        var _coachKey = 'none';
        // nearmiss + voiceonly both require the co-occur window to have EXPIRED (!speechReady) so the
        // coaching reads as POST-attempt — never a flash of "show your fingers" while the voice window
        // is still live and the take could still succeed (codex F1). The live window is already guided
        // by the resting liveEl prompt above. gestureonly has no voice window to expire, so the stable
        // gesture + 600ms debounce IS its "attempt".
        if (_speechMode !== 'off' && currentDigitIndex < totalSteps && !inConfirmBeat) {
            if (_coVoiceFired && !speechReady[currentDigitIndex] && _coGestureSeen)       _coachKey = 'nearmiss';
            else if (_coVoiceFired && !speechReady[currentDigitIndex] && !_coGestureSeen) _coachKey = 'voiceonly';
            else if (_coGestureSeen && !_coVoiceFired)                                    _coachKey = 'gestureonly';
        }
        // Debounce: a candidate must persist COACH_DEBOUNCE_MS continuously before it shows (so a fast
        // synced user — gone in <600ms — never sees it); 'none' clears the shown hint INSTANTLY so it
        // vanishes the moment the digit advances or the user corrects.
        if (_coachKey !== _coachCandidate) { _coachCandidate = _coachKey; _coachCandidateAt = _now; }
        if (_coachKey === 'none') { _coachKeyShown = 'none'; }
        else if ((_now - _coachCandidateAt) >= COACH_DEBOUNCE_MS) { _coachKeyShown = _coachKey; }

        // F-563 (2): drive the BIG guided panel off the SAME per-digit flags (no gate change).
        // gesture done = _qaGestureLatched (set once a stable deliberate gesture is confirmed for
        // this digit, content-blind); voice done = speechReady[currentDigitIndex].
        try {
            var _gPct = Math.min(Math.round((stableFrames / STABLE_FRAMES_NEEDED) * 100), 100);
            CaptureFeedback.renderGuided(ctx, {
                coachKey: _coachKeyShown,   // F-599: debounced adaptive co-occurrence coaching key
                done: currentDigitIndex >= totalSteps,
                beat: inConfirmBeat,
                digit: _curDigit,
                gestureDone: _qaGestureLatched,
                gestureLive: (detected > 0),   // SHOW-AS-YOU-SAY: fingers visible NOW (drives the live ✋ lamp)
                handPresent: _handPresent,     // hand visible in frame at all
                handNear: _handNear,           // hand inside the near-face capture zone
                gesturePct: _gPct,
                voiceOn: (_speechMode !== 'off'),
                voiceDone: !!speechReady[currentDigitIndex],
                rearmed: _acceptArmed,   // speech-off: a held pose can be gesture-confirmed but NOT re-armed (blocked) — don't show "Got it"
                voiceHelp: !!(_gestureReadyAt && (_now - _gestureReadyAt) > VOICE_HELP_TIMEOUT_MS),
                energyHeard: _vadEnergyDetected  // D-VOICE-GATE-SPEAKER-AGNOSTIC: energy heard but content not matched yet
            });
        } catch(_) {}

        // F-561/F-563: stuck-user escape + persistent "(voice gate off)" note.
        // "Waiting on voice" must cover BOTH:
        //   - latched + hand DOWN (the camera-free say step), and
        //   - gesture HELD-ready but not yet latched (e.g. an adjacent repeated digit held while a
        //     broken mic never re-arms it) — else the mic-escape would never appear (codex).
        var _gestureHeldReady = (detected > 0 && stableFrames >= STABLE_FRAMES_NEEDED);
        if (_gestureHeldReady && !_gestureReadyAt) _gestureReadyAt = _now;   // start the voice-wait timer the moment the gesture is first ready (before the latch)
        var _waitingVoice = (_qaGestureLatched || _gestureHeldReady) && (_speechMode !== 'off') && !speechReady[currentDigitIndex] && currentDigitIndex < totalSteps;
        if (_waitingVoice && _gestureReadyAt && (_now - _gestureReadyAt) > VOICE_HELP_TIMEOUT_MS) { _ensureVoiceEscape(); }
        else { _removeVoiceEscape(); }
        _renderVoiceOffNote();
        // D2: once the gesture is confirmed and we're only waiting on voice, the 8s
        // "hold hand closer" hint is wrong here — suppress it.
        CaptureFeedback.renderFingerPhase(ctx, hintShown && !_waitingVoice, currentDigitIndex);
        rafId = requestAnimationFrame(runDetectionLoop);
    }

    // ── F-561 (S111): gate the phrase→digits transition on SPEECH, not just the timer.
    // Same class as the per-digit AND-gate but for the phrase phase: don't leave the phrase
    // until we've actually heard the user speak it (pacing only — Gemini validates content).
    // Reuses the audioAnalyser from startAudioMonitor. W4.1 fallbacks (never hang): VAD
    // unavailable → timer; a hard safety cap so a silent/broken mic can't hold forever.
    let _phraseVoicedTicks = 0;
    let _phraseSilenceTicks = 0;
    let _phraseHeardVoice = false;
    let phraseSpoke = false;
    let _phraseHeardAt = 0;                            // F-563: when the greeting was HEARD — drives the "✓ Heard it" beat before advancing (digit parity)
    // D-VOICE-GATE-SPEAKER-AGNOSTIC: phrase content gate state
    let _phraseContentGate = null;
    let _phraseContentMatched = false;
    const GREET_HEARD_BEAT_MS = 800;                  // hold the greeting ✓ this long so the user KNOWS it registered, like a digit's ✓
    // F-563 (Finding 2): the on-device VAD is a PACING gate, NOT the security check — Gemini
    // server-side is the authoritative word verifier. The old ~400ms threshold (2 ticks) fired on a
    // single cough/scrape/hum burst. Real speech is SUSTAINED + MODULATED over the word duration, so
    // require ~1.4s of voiced energy AND that it actually varies (a flat hum has near-constant rms).
    // The spoken anchor is "[word], I am [name]" (first auth) or — in the F-648 seal gate — the
    // user saying their numbers (>=~1.5s either way), so this won't stall it. LIVE-TUNE.
    const PHRASE_VOICED_TICKS_NEEDED = 7;             // ~1.4s of voiced energy (TICK_MS=200) — a real multi-word greeting, not a transient
    const PHRASE_MOD_DELTA = 0.045;                  // modulation floor: the voiced run's rms range must exceed this (speech varies; a flat tone/hum doesn't). Best-effort — Gemini is authoritative.
    const PHRASE_SILENCE_TICKS_NEEDED = 2;            // ~400ms end-pause = the greeting utterance is COMPLETE (not a mid-word dip)
    const SILENT_RECOVERY_TICKS = 28;                // ~5.6s of genuine near-silence (rms < VAD_SILENCE_RMS_FALLBACK) with NO voiced energy → surface the "we can't hear you" recovery (connected-but-silent mic), instead of silently holding to the hard cap. LIVE-TUNE.
    const PHRASE_PHASE_MAX_S = PHRASE_DURATION + 12;  // hard cap past the timer — a final backstop so it can never hang
    let _phraseVoicedMin = 1, _phraseVoicedMax = 0;   // rms range during the current voiced run (the modulation check)
    let _phraseSilentRun = 0;                         // consecutive near-silent ticks (the connected-but-silent-mic detector)
    // F-561 (S111): phraseSpoke = a COMPLETED greeting utterance — a sustained voiced run THEN
    // a real end-pause — not "any 600ms of voice". The greeting is greeting-only now; the NUMBERS
    // are spoken per-digit (each bound to its gesture), never in the phrase phase.
    // F-595: turn the greeting samples into THIS session's digit-gate threshold. Called once,
    // when the greeting is confirmed (phraseSpoke). If the samples are too thin to trust (instant
    // talker → no floor, or a clipped greeting), keep the FALLBACK — same graceful-degrade spirit
    // as the no-mic path. The digit gate (vadSpeechThreshold / vadSilenceThreshold) reads the result.
    function _finalizeCalibration() {
        _calNoiseFloor = (_floorSamples.length >= _CAL_MIN_FLOOR) ? _calMedian(_floorSamples) : null;
        _calSpeechRms = (_speechSamples.length >= 4) ? _calMedian(_speechSamples) : null;
        if (_calNoiseFloor != null && _calSpeechRms != null && (_calSpeechRms - _calNoiseFloor) >= _CAL_MIN_SPAN) {
            const _span = _calSpeechRms - _calNoiseFloor;
            // speech threshold 40% of the way floor→speech (sensitive but clear of noise).
            vadSpeechThreshold = _calClamp(_calNoiseFloor + _CAL_K * _span, 0.06, Math.max(0.13, _calNoiseFloor + 0.03));  // S154: same data-driven ceiling as module-scope calibration (see comment there)
            // silence threshold 30% of the way from floor to the SPEECH THRESHOLD — provably
            // floor < silence < speechThreshold (no clamp can invert it), so the digit gate's
            // silence→voice hysteresis band stays valid for THIS session's mic.
            vadSilenceThreshold = _calNoiseFloor + _CAL_SIL_K * (vadSpeechThreshold - _calNoiseFloor);
            _calIsFallback = false;
        } else {
            // too thin to trust (no floor, clipped greeting, or contaminated sample) → keep the
            // CURRENT pair (already the active values — preflight-derived if arm found one,
            // fallback constants otherwise), same graceful-degrade spirit as no-mic. Don't stomp
            // _calIsFallback back to true here: a noisy room that starved the greeting sample is
            // exactly the case the preflight-derived arm value exists to cover, and it's still
            // the active pair below (D-VAD-CALIBRATION-GREETING-BOUND).
        }
        // S157 C1: anchor adapt tracking to the calibrated floor so per-window re-derivation
        // doesn't false-alarm immediately after phraseSpoke recalibration runs.
        if (_calNoiseFloor != null) _adaptLastFloor = _calNoiseFloor;
        else _adaptLastFloor = (audioNoiseFloor > 0.001) ? audioNoiseFloor : 0.010;
        try { vacDebug('vad_calibrated', null, { floor: _calNoiseFloor == null ? null : Number(_calNoiseFloor.toFixed(3)), speech: _calSpeechRms == null ? null : Number(_calSpeechRms.toFixed(3)), thr: Number(vadSpeechThreshold.toFixed(3)), sil: Number(vadSilenceThreshold.toFixed(3)), fallback: _calIsFallback, floor_n: _floorSamples.length, speech_n: _speechSamples.length, source: 'phrase_calibration' }); } catch(_) {}
        try { QA.cal({ floor: _calNoiseFloor, speech: _calSpeechRms, thr: vadSpeechThreshold, sil: vadSilenceThreshold, fallback: _calIsFallback }); } catch(_) {}
    }

    function _phraseVadTick() {
        if (!audioAnalyser || phraseSpoke) return;
        // D-VOICE-GATE-SPEAKER-AGNOSTIC: content gate sets _phraseContentMatched; tick reads it
        if (_phraseContentMatched && !_phraseHeardVoice) {
            _phraseHeardVoice = true;
            try { vacDebug('phrase_content_matched', null, { ticks: _phraseVoicedTicks }); } catch(_) {}
        }
        try {
            // task-644: time-domain RMS so iOS doesn't pin at 0.01 (same fix as digit VAD tick)
            const _buf = new Uint8Array(audioAnalyser.frequencyBinCount);  // freq-domain — voiceBandRatio only
            const _tdbuf = new Uint8Array(audioAnalyser.fftSize);          // time-domain — RMS only
            audioAnalyser.getByteTimeDomainData(_tdbuf);
            let _rms = 0; for (let i = 0; i < _tdbuf.length; i++) { const _pv = _tdbuf[i] - 128; _rms += _pv * _pv; }
            _rms = Math.sqrt(_rms / _tdbuf.length) / 128;
            audioAnalyser.getByteFrequencyData(_buf);
            const _vbRatio = _voiceBandRatio(audioAnalyser, _buf);  // BUILD 379: fraction of energy in the 85Hz-3kHz voice band
            _lastVbRatio = _vbRatio;  // surfaced to the QA overlay
            window.__vacGateArmed = true; _micPillDraw(_rms, VAD_SPEECH_RMS_FALLBACK, 'g');  // S145c/d: user settles to the line while F-595 calibration listens (kills the loud-greeting feedback loop)
            // (a) CONNECTED-BUT-SILENT mic detector: sustained genuine near-silence with NO voiced
            // energy → the mic is present but too quiet to ever satisfy the gate. Surface the "we
            // can't hear you" recovery rather than silently holding to the hard cap (Finding/silent-mic).
            if (_rms < VAD_SILENCE_RMS_FALLBACK) {
                // F-595 (A2): the room's NOISE FLOOR — leading near-silent frames BEFORE the user's
                // first sustained voiced run. Collected passively (no blocking "getting ready" screen,
                // no added latency: the user always takes a beat to start reading the greeting). Capped
                // so a long pre-speech pause can't pile up; median (not mean) at finalize ignores a click.
                if (!_phraseHeardVoice && _phraseVoicedTicks === 0 && _floorSamples.length < _CAL_FLOOR_MAX) _floorSamples.push(_rms);
                // NOT in voice-only mode — there the user has no gesture phase to fall back on, so
                // "skip voice" would leave nothing to verify; let voice-only hard-cap → fail → retry
                // instead (codex). Finger mode can degrade to gesture-only, so the recovery applies.
                if (++_phraseSilentRun >= SILENT_RECOVERY_TICKS && fingerFallback !== 'voice') { try { _showNoMicRecovery('quiet'); } catch(_) {} }
            } else {
                _phraseSilentRun = 0;
            }
            if (_rms > VAD_SPEECH_RMS_FALLBACK && _vbRatio >= VOICE_BAND_MIN_RATIO) {
                // BUILD 379: same voice-band gate as the digit tick — amplitude alone isn't enough
                // in a loud broadband room; a failing vbRatio falls through to the neither-band branch.
                _phraseSilenceTicks = 0;
                _phraseVoicedTicks++;
                // F-595 (A3): the SPEECH sample — this user's greeting loudness on THIS mic+room.
                // Median of the voiced run feeds the per-session threshold at phraseSpoke.
                if (_speechSamples.length < _CAL_SPEECH_MAX) _speechSamples.push(_rms);
                if (_rms < _phraseVoicedMin) _phraseVoicedMin = _rms;   // track the run's range for the modulation check
                if (_rms > _phraseVoicedMax) _phraseVoicedMax = _rms;
                // S157: content-gate no-match escape (phrase twin of the digit no-match path).
                // Chrome's SpeechRecognition opens its OWN mic capture; under macOS device
                // contention it can hear silence forever while THIS analyser proves sustained
                // modulated voice (Rob, live: "RMS moves with voice but does not trigger the
                // voice gate"). If the content gate has accumulated ~3x the voiced evidence a
                // greeting needs and still produced no match, drop to the energy path — the
                // server verdict still judges the recorded words (content authority unchanged).
                if (_sessionGateAvail && !_phraseContentMatched && _phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED * 3) {
                    _sessionGateAvail = false;
                    if (_phraseContentGate) { try { _phraseContentGate.stop(); } catch(_) {} _phraseContentGate = null; }
                    try { vacDebug('phrase_content_gate_nomatch_escape', null, { voiced_ticks: _phraseVoicedTicks, mod: Number((_phraseVoicedMax - _phraseVoicedMin).toFixed(3)) }); } catch(_) {}
                }
                // D-VOICE-GATE-SPEAKER-AGNOSTIC: when content gate is available, energy alone
                // does NOT set _phraseHeardVoice — content match (via _phraseContentMatched) does.
                // Energy fallback: fire when content gate unavailable (Firefox / unsupported).
                if (!_sessionGateAvail) {
                    // Finding 2: require SUSTAINED voiced energy (~1.4s) AND modulation — so a single ~400ms
                    // transient (cough/scrape) OR a flat continuous hum can't satisfy "greeting heard".
                    if (_phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED && (_phraseVoicedMax - _phraseVoicedMin) >= PHRASE_MOD_DELTA) {
                        _phraseHeardVoice = true;
                    }
                }
            } else if (_rms < VAD_SILENCE_RMS_FALLBACK) {
                if (!_phraseHeardVoice) {
                    // Not a sustained greeting yet — DECAY the voiced run so intermittent noise can't
                    // accumulate across silences; reset the modulation window when it fully decays.
                    _phraseVoicedTicks = Math.max(0, _phraseVoicedTicks - 1);
                    // F-595 (anti-contamination): when a pre-greeting burst (cough/tap/TV/mic-test)
                    // fully decays to silence, drop its loud frames too — only the SUSTAINED run that
                    // becomes the real greeting should feed the speech median. Mirrors the min/max reset.
                    if (_phraseVoicedTicks === 0) { _phraseVoicedMin = 1; _phraseVoicedMax = 0; _speechSamples.length = 0; }
                } else if (++_phraseSilenceTicks >= PHRASE_SILENCE_TICKS_NEEDED) {
                    // sustained, modulated voiced run THEN a real end-pause → utterance complete
                    phraseSpoke = true;
                    try { vacDebug('phrase_speech_confirmed', null, { rms: Number(_rms.toFixed(3)), voiced_ticks: _phraseVoicedTicks, mod: Number((_phraseVoicedMax - _phraseVoicedMin).toFixed(3)) }); } catch(_) {}
                    try { _finalizeCalibration(); } catch(_) {}   // F-595: the greeting just gave us floor + speech → set this session's digit-gate threshold
                }
            }
            // 0.085–0.14 band (neither): hold counters
        } catch(_) {}
    }

    // F-563 (greeting = first-class gate): the greeting now gets the SAME show→listen→✓ treatment
    // as a digit (it's the FIRST thing the user hits, so its clarity sets the tone). Shows the
    // ACTUAL greeting text BIG + readable, a clear listening state, and a "✓ Heard it" confirmation
    // before advancing — so the user KNOWS it registered. #vacEqHost is where the live equaliser
    // mounts (F-563 piece 2). Pacing only — the phrase gate (phraseSpoke) is unchanged.
    function renderGreeting() {
        if (_ceremonyPhase !== _PHASE.GREETING) return;   // L-2246: guard — stale phraseInterval tick must not paint greeting text in digit phase
        // D-QUICKAUTH-MIC-COLD-START parity (full path): if AudioContext was just created and is
        // still suspended, hold "Preparing mic…" — phraseInterval will re-call within 200ms when
        // ready. Full path has implicit warmup (user reads the phrase), but an explicit guard closes
        // the same race on any config/device where context creation takes an unexpected route.
        // Fallthrough after 3s: if AudioContext stays non-running that long (iOS PWA backgrounded,
        // permission revoked), show the phrase anyway — prior behaviour was always to show it, and
        // the analyser degrades gracefully (W4.1 gesture-only mode). 3s >> typical resume latency
        // and << PHRASE_DURATION (so the user still has time to speak the phrase).
        // S157: resume was capped at 3s with a swallowed rejection — on macOS Chrome a
        // context that stays suspended (resume() without a fresh user gesture rejects)
        // left the ANALYSER permanently deaf: RMS 1% forever while the MediaRecorder
        // (separate plumbing, no AudioContext) recorded fine — every client audio gate
        // then walled the user against a meter reading silence. Now: retry resume on
        // EVERY tick while non-running, bind a one-shot gesture resume (click/keydown —
        // the reliable path on gesture-gated platforms), and surface the state honestly.
        // Progression still falls through after 3s (gesture-only degraded mode unchanged).
        if (audioContext && audioContext.state !== 'running') {
            try { audioContext.resume().catch(function(){}); } catch(_) {}
            if (!window.__vacGestureResumeBound) {
                window.__vacGestureResumeBound = true;
                var _gr = function() {
                    try { if (audioContext && audioContext.state !== 'running') audioContext.resume().catch(function(){}); } catch(_) {}
                    try { if (avAudioCtx && avAudioCtx.state !== 'running') avAudioCtx.resume().catch(function(){}); } catch(_) {}
                };
                try { document.addEventListener('click', _gr, { passive: true }); document.addEventListener('keydown', _gr, { passive: true }); } catch(_) {}
            }
            try { vacDebug('audio_ctx_suspended', audioContext.state, { elapsedMs: elapsedMs }); } catch(_) {}
        }
        if (audioContext && audioContext.state !== 'running' && elapsedMs < 3000) {
            var _stPre = document.getElementById('step2Title');
            if (_stPre && _stPre.textContent !== 'Preparing mic…') { _stPre.textContent = 'Preparing mic…'; _stPre.style.color = '#fbbf24'; }
            return;  // re-rendered by the next phraseInterval tick once context is running (or 3s elapses)
        }
        var _full = challengeData?.phrase || '';
        var _vo = (fingerFallback === 'voice');
        // F-563 (#4): show the FULL phrase INCLUDING the digits (say them all up front), not the
        // greeting-only strip. The backend matches the whole transcript (set-overlap), so the digits
        // must be spoken here to reach it; finger mode ALSO re-says each digit per-gesture (on-device
        // pacing). Reconciles the screen with what the backend expects. (Server-side cross-modal
        // binding is a separate vac-system fix — see the backend ticket; not over-claimed here.)
        // R2 (S114): the greeting screen shows ONLY the greeting in FINGER mode — strip the trailing
        // digits (same pattern as goToChallenge's greetPart). Showing the numbers here made the user
        // try to say/show them during the greeting (wrong order). They're spoken per-gesture in the
        // digit phase; it's ONE recording, so the backend whole-transcript match still gets them.
        // VOICE-ONLY keeps the full phrase (it has no digit phase, so it must say the numbers here).
        // S114: finger-mode greeting comes from the SINGLE source (vacGreetingText) — same rotating
        // greeting + real name the intro previews — so the two screens can never diverge.
        // F-648: when greeting:skip (the seal gate), the live phrase prompt is the NUMBERS only —
        // the user says the fresh per-session digits (the anti-replay anchor), NO greeting and NO
        // "I am {name}". The backend phrase is digits-only, so the scorer core is the digits and a
        // digits-only read scores 1.0. Otherwise (normal) show the greeting; voice-only shows the full phrase.
        var _say;
        if (_vo) {
            _say = _full;
        } else if (skipGreeting) {
            _say = ((challengeData && challengeData.digits) || []).join(' ');
        } else {
            _say = vacGreetingText() || _full.replace(/,\s*\d[\d\s,]*$/, '');
        }
        var _st = document.getElementById('step2Title');
        // ✓ Heard it beat — FINGER mode only, AND only AFTER the read window (PHRASE_DURATION). The
        // phrase now includes the digits, so phraseSpoke can fire on a pause after the greeting clause
        // — keep the FULL phrase visible through the read window so the user actually says the digits
        // up front; only confirm once the window has elapsed (codex).
        if (phraseSpoke && !_vo && (elapsedMs / 1000) >= PHRASE_DURATION) {
            if (_st) { _st.textContent = 'Greeting heard'; _st.style.color = '#22c55e'; }
            // Don't instruct "now the numbers" yet — the digit phase doesn't start until the timer
            // floor + the "GET READY — SHOW FINGERS IN" grace countdown, which is what actually cues it
            // (codex: avoid telling the user to start while input is still ignored).
            challengeEl.innerHTML = '<div style="font-size:clamp(24px,7vw,34px);font-weight:800;color:#22c55e;line-height:1.2;">✓ Heard it</div>'
                + '<div style="font-size:clamp(12px,3.4vw,14px);color:var(--text-secondary);margin-top:6px;">One moment…</div>';
            var _eqH = document.getElementById('vacEqGreeting'); if (_eqH) _eqH.style.display = 'none';   // ✓ → hide the listening eq
            return;
        }
        if (_st) { _st.textContent = 'Say the phrase'; _st.style.color = '#fbbf24'; }
        var _listening = (elapsedMs / 1000) >= PHRASE_DURATION;   // past the read window → emphasise "we're listening"
        challengeEl.innerHTML =
            '<div style="font-size:clamp(11px,3vw,12px);font-family:var(--mono);letter-spacing:1.5px;color:#fbbf24;margin-bottom:6px;">' + (_listening ? 'LISTENING — SAY IT OUT LOUD' : (_vo ? 'READ THIS OUT LOUD — INCLUDING THE NUMBERS' : 'SAY THIS OUT LOUD')) + '</div>'
            + '<div style="font-size:clamp(22px,6.5vw,32px);font-weight:800;color:#fbbf24;line-height:1.3;">“' + _say + '”</div>'
            + (_vo ? '' : '<div style="font-size:clamp(12px,3.2vw,13px);color:var(--text-tertiary);margin-top:6px;">then show each number as you say it, one take</div>');
        // Show the live eq (STABLE element in #challengePanel, updated every frame by startAudioMonitor)
        // — proof the mic is hearing the greeting. Hidden if there's no mic (eq can't move anyway).
        var _eq = document.getElementById('vacEqGreeting'); if (_eq) _eq.style.display = audioAnalyser ? 'flex' : 'none';
    }

    // D-VOICE-GATE-SPEAKER-AGNOSTIC: start phrase content gate (grabs key tokens from
    // the challenge phrase — both the greeting word(s) and the digit set). Fires
    // _phraseContentMatched = true when the transcript covers at least half the tokens.
    // Stopped when phraseSpoke fires (content consumed) or recording ends.
    if (_sessionGateAvail && PHRASE_DURATION > 0 && !_dropVoicePhrase) {
        try {
            var _phr = challengeData && (challengeData.phrase || '');
            var _phrTokens = _phr.toLowerCase().split(/\s+/).filter(function(t){ return t.length >= 2; });
            // Always include digit numerals as tokens (language-tolerant: "two" OR "2")
            if (challengeData && challengeData.digits) {
                challengeData.digits.forEach(function(d){ _phrTokens.push(String(d)); });
            }
            if (_phrTokens.length) {
                _phraseContentGate = _startPhraseContentGate(_phrTokens, function() {
                    _phraseContentMatched = true;
                    if (_phraseContentGate) { _phraseContentGate.stop(); _phraseContentGate = null; }
                    try { vacDebug('phrase_content_gate_matched', null, { tokens: _phrTokens.length }); } catch(_) {}
                }, function(fatalReason) {
                    // S157: recognizer died mid-flight (network STT / restart failure) —
                    // flip to the energy fallback exactly as the startup-failure path does.
                    // Server-side content verification of the recording remains the authority.
                    _sessionGateAvail = false;
                    if (_phraseContentGate) { try { _phraseContentGate.stop(); } catch(_) {} _phraseContentGate = null; }
                    try { vacDebug('phrase_content_gate_fatal', String(fatalReason || 'fatal')); } catch(_) {}
                });
                // null return = runtime permission failure; disable content gate so _phraseVadTick
                // energy fallback activates and the phrase step can still proceed (degraded mode).
                if (!_phraseContentGate) { _sessionGateAvail = false; }
            }
        } catch(_) {}
    }

    // ── Phase 1: phrase timer + speech gate (user speaks the challenge phrase) ───────────
    // NOTE: _setPhase(GREETING) is already called above in the initial render block
    // (before the first renderGreeting() call). It is NOT called here to avoid overwriting
    // DIGIT on the _dropVoicePhrase path, which sets DIGIT above and advances in the first tick.
    const phraseInterval = setInterval(() => {
        if (recordingStopped) { clearInterval(phraseInterval); return; }
        elapsedMs += TICK_MS;
        const elapsedSec = elapsedMs / 1000;
        timerEl.textContent = Math.max(Math.ceil(totalDuration - elapsedSec), 0);
        ringFill.style.strokeDashoffset = circumference * (elapsedSec / totalDuration);
        // F-563 recoverability: if there's genuinely no mic, surface the recovery NOW (during the
        // greeting) instead of letting the user speak into a dead mic and hit the silent dead-end.
        if (!audioAnalyser && fingerFallback !== 'voice') { try { _showNoMicRecovery(); } catch(_) {} }
        _phraseVadTick();   // F-561 (S111): listen for the spoken phrase

        // F-561: gate phrase→digits on SPEECH, not just the timer. Don't advance until we've
        // heard the phrase — or VAD is unavailable (timer fallback, W4.1), or the hard cap is
        // hit so a silent/broken mic can't hang forever.
        const _phraseTimerDone = elapsedSec >= PHRASE_DURATION;
        // window.__vacVoiceSkipped = the user picked "Continue — skip voice" on the recovery panel.
        const _phraseGateOk = phraseSpoke || !audioAnalyser || window.__vacVoiceSkipped || (elapsedSec >= PHRASE_PHASE_MAX_S);
        // F-563: KEEP the original PHRASE_DURATION timer floor (don't early-advance — a natural pause
        // mid-greeting can trip phraseSpoke on a PARTIAL greeting, and cutting off the rest would fail
        // server-side phrase verification; codex). The UX win is the "✓ Heard it" BEAT: once the
        // greeting is heard, show ✓, then advance after the beat. The ✓ itself appears immediately on
        // phraseSpoke (in renderGreeting) for instant feedback; the timer floor still governs advance.
        const _voiceOnly = (fingerFallback === 'voice');
        // Start the "✓ Heard it" beat only once the read window has ALSO elapsed (the phrase now
        // includes the digits, so phraseSpoke can fire early on a greeting-clause pause). Aligning the
        // beat start with the floor keeps the ✓ visible for its full beat instead of being skipped
        // because the timer already lapsed (codex). The `_phraseHeardAt &&` guard avoids treating an
        // unset (0) timestamp as "beat already done".
        if (phraseSpoke && _phraseTimerDone && !_phraseHeardAt) _phraseHeardAt = performance.now();
        const _heardBeatDone = !phraseSpoke || (_phraseHeardAt && (performance.now() - _phraseHeardAt >= GREET_HEARD_BEAT_MS));
        // F-648 (was F-635-LIGHTER / L-2171): greeting:skip KEEPS the phrase phase — the user must
        // still SPEAK here (now they say the NUMBERS, the per-session anti-replay anchor). The phase
        // is the voice/liveness anchor + the F-595 digit-gate calibration; it must NOT be bypassed
        // (an earlier build bypassed it so nothing was scored → the L-2170 trap). greeting:skip runs
        // the normal phrase gate with name-less prompt copy; the backend phrase is digits-only so the
        // digits-only read scores 1.0 (the name is gone from BOTH the prompt and the expected phrase).
        const _advanceGreeting = _dropVoicePhrase ? true : (_phraseTimerDone && _phraseGateOk && (_voiceOnly || _heardBeatDone));
        // F-654: when COPS/PID policy drops the voice-phrase modality (the same-session SEAL
        // re-auth — full strength, no greeting), there is NO spoken-phrase phase to wait for.
        // The speech gate (_phraseGateOk) would otherwise hold here waiting for phraseSpoke /
        // the 12s hard cap even with PHRASE_DURATION=0, which is exactly the "asks for audio
        // first" symptom. Advance straight to the digit/finger phase — the digits are spoken
        // per gesture there, so the voice/liveness signal is still captured, just not as a
        // separate up-front phase. (Non-seal paths are unchanged: _dropVoicePhrase defaults
        // false unless the server policy affirmatively lists no voice modality.)
        if (_advanceGreeting) {
            _setPhase(_PHASE.DIGIT);   // L-2246: transition to DIGIT before clearInterval so any final phraseInterval tick is blocked by renderGreeting's guard
            // F-563 (2): hide the greeting eq on EVERY phrase exit (it's a stable element outside
            // challengeText, so finger-phase innerHTML updates won't remove it — and the ✓ branch
            // doesn't run on a timeout/fail-open exit; codex).
            try { var _egE = document.getElementById('vacEqGreeting'); if (_egE) _egE.style.display = 'none'; } catch(_) {}
            // SHIP-BLOCKER LOUD LOG: the phrase advanced WITHOUT a confirmed voice. The on-device VAD
            // is UX pacing (Gemini server-side is the authoritative voice check), so this isn't a
            // security bypass — but a !audioAnalyser fail-open means the user was NOT paced to speak,
            // which silently degrades the flow. Log it loudly so it's never invisible (the audio
            // hardening + the re-auth reload should keep this from firing on re-entry).
            if (!audioAnalyser) {
                console.error('[VAC][VOICE] phrase gate FAIL-OPEN — advanced with NO audioAnalyser (voice pacing OFF). Not a security bypass (Gemini validates voice server-side) but the user was not prompted to speak.');
                try { vacDebug('phrase_gate_fail_open', 'no_audioAnalyser', { elapsed_s: Math.round(elapsedSec) }); } catch(_) {}
            } else if (!phraseSpoke) {
                try { vacDebug('phrase_speech_timeout', null, { waited_s: Math.round(elapsedSec) }); } catch(_) {}
            }
            clearInterval(phraseInterval);
            // Voice-only mode or no digits → skip straight to completion
            if (fingerFallback === 'voice' || digits.length === 0) {
                finishFingerPhase();
                return;
            }
            // ── Phase 2: finger detection (HandLandmarker) or timer fallback ──
            // S110 (evidence-led fix): the first-finger "lag" was NOT cold-start — the
            // console showed detection works on its first active frame. The cause was
            // this grace period being a 1.5s DETECTION BLACKOUT (the detect loop didn't
            // run at all during it), so dots/lines couldn't appear for 1.5s on digit 1.
            // Fix: (a) shorten grace to 600ms (the ~0.6s stability gate + the new hand
            // pre-flight already prevent instant-advance, so the long grace is redundant),
            // and (b) DRAW THE SKELETON during grace so the user sees their hand tracked
            // immediately — advancement is still held until grace ends.
            digitStartTime = performance.now();
            // F-561: start the on-device VAD gate now (finger phase start) so it's warm,
            // but keep digit-0's voice window CLOSED through the grace — otherwise the
            // spoken-PHRASE tail can cross the VAD threshold and pre-satisfy digit 0
            // without the user saying that digit (codex P2). Window opens at grace-end.
            _startSpeechGate();
            const GRACE_MS = 300;
            let graceRemaining = Math.ceil(GRACE_MS / 1000);
            // skeleton-during-grace: visual feedback only, no advancement
            let _graceDrawRAF = null;
            (function graceDraw(){
                if (recordingStopped) return;
                const gv = document.getElementById('videoPreviewRec');
                try { FingerDetector.detect(gv); _drawHandSkeleton(gv, FingerDetector.landmarks, digits[currentDigitIndex]); document.getElementById('cameraBoxRec').classList.toggle('hand-visible', !!FingerDetector.landmarks); } catch(_){}
                _graceDrawRAF = requestAnimationFrame(graceDraw);
            })();
            function renderGrace() {
                // S111 #3: numbers are in #digitStrip above; this panel shows the countdown only.
                var _st2 = document.getElementById('step2Title');   // F-563 UX: header moves from the greeting to the numbers phase
                if (_st2) { _st2.textContent = 'Show the numbers'; _st2.style.color = ''; }
                // F-AUTH-UX-POLISH (2): NO bare numeric countdown here. GRACE_MS is sub-second
                // (300ms), so Math.ceil(GRACE_MS/1000) is ALWAYS "1" and never decrements — and a
                // big "1" rendered right under "SHOW FINGERS" reads as "show 1 finger", flashing a
                // wrong first-digit cue for the grace frame before renderGuided paints the real
                // digits[0]. Show a non-numeric "get ready" beat; only render the numeral if the
                // grace is ever long enough for a real, decrementing countdown (>= 1s).
                var _showCount = (GRACE_MS >= 1000);
                challengeEl.innerHTML = '<span style="font-size:12px;color:#fbbf24;display:block;margin-bottom:4px;font-family:var(--mono);letter-spacing:1px;font-weight:600;">GET READY — SHOW FINGERS</span>'
                    + (_showCount
                        ? '<span style="font-size:32px;color:#fbbf24;font-weight:700;font-family:var(--mono);">' + graceRemaining + '</span>'
                        : '<span style="font-size:18px;color:#fbbf24;font-weight:700;">Starting…</span>');
            }
            renderGrace();
            try { CaptureFeedback.renderDigitStrip(ctx, 0); } catch(_) {}
            try { vacDebug('phase2_entering', null, { detector_ready: FingerDetector.ready, detector_failed: FingerDetector.failed, module_loaded: !!window.__VAC_MediaPipe, digits_count: digits.length }); } catch(_) {}
            console.log('[VAC] Finger phase entering — detector ready=' + FingerDetector.ready + ' failed=' + FingerDetector.failed);

            // Count down the grace period visually
            const graceInterval = setInterval(function() {
                if (recordingStopped) { clearInterval(graceInterval); return; }
                graceRemaining--;
                if (graceRemaining > 0) {
                    renderGrace();
                } else {
                    clearInterval(graceInterval);
                }
            }, 1000);

            // After grace period, start the actual detection/fallback path
            setTimeout(function() {
                if (recordingStopped) return;
                clearInterval(graceInterval);
                if (_graceDrawRAF) cancelAnimationFrame(_graceDrawRAF);  // stop grace-draw before the real loop owns the camera
                // Reset digitStartTime so HINT_TIMEOUT counts from the real start
                digitStartTime = performance.now();
                // F-561: NOW open digit-0's voice window — grace is done and the phrase
                // is finished, so speech from here is the digit, not the phrase tail (codex P2).
                speechWindowStart = performance.now();
                // NOTE: do NOT reset _sawSilence here — silence during grace must arm digit 0
                // so a number spoken across the grace→window boundary still counts (codex). It
                // starts false (init) and only a real grace silence sets it true; greeting-tail
                // bleed (continuous voice, no pause) leaves it false → rejected.
                try { vacDebug('speech_window_open', null, { digit_index: 0, at_perf: speechWindowStart }); } catch(_) {}
                // W4.1 hand-stays-up model: no drop-hand gate. A hand already in
                // frame at grace-end won't instant-advance because the stability
                // gate requires the count to be HELD ~0.6s before it's accepted.
                stableCount = 0;
                stableFrames = 0;
                CaptureFeedback.renderFingerPhase(ctx, false, currentDigitIndex);
                // S110: switch the ring/number from countdown to calm progress at
                // the start of the detection phase — the user shows numbers at their
                // own pace; nothing is racing a clock here.
                try {
                    ringFill.classList.remove('recording');
                    ringFill.style.stroke = 'var(--teal)';
                    ringFill.style.strokeDashoffset = circumference;
                    timerEl.style.fontSize = '14px';
                    timerEl.textContent = '0/' + digits.length;
                } catch(_) {}
                try { vacDebug('phase2_grace_complete', null, { grace_ms: GRACE_MS }); } catch(_) {}
                if (FingerDetector.ready) {
                    try { vacDebug('phase2_path_detection'); } catch(_) {}
                    rafId = requestAnimationFrame(runDetectionLoop);
                } else if (FingerDetector.failed) {
                    try { vacDebug('phase2_path_fallback_immediate', 'Detector already failed during init'); } catch(_) {}
                    console.log('[VAC] Finger phase: detector already failed during init, using timer fallback');
                    runTimerFallback();
                } else {
                    // Init may still be in flight. Kick off init + poll readiness up to
                    // ~10s before giving up. CDN WASM download on 4G can take >5s and
                    // phase 1 may be only 2-5s (SPEED_CONFIG phrase duration).
                    console.log('[VAC] Finger phase: detector not ready yet, waiting for init');
                    FingerDetector.init(); // no-op if already running
                    const POLL_MS = 200;
                    const MAX_POLLS = 50;  // 10 seconds total
                    let polls = 0;
                    const pollInterval = setInterval(function() {
                        if (recordingStopped) { clearInterval(pollInterval); return; }
                        polls++;
                        if (FingerDetector.ready) {
                            clearInterval(pollInterval);
                            console.log('[VAC] Finger phase: detector ready after ' + (polls * POLL_MS) + 'ms wait');
                            rafId = requestAnimationFrame(runDetectionLoop);
                        } else if (FingerDetector.failed) {
                            clearInterval(pollInterval);
                            console.log('[VAC] Finger phase: detector failed while waiting, using timer fallback');
                            runTimerFallback();
                        } else if (polls >= MAX_POLLS) {
                            clearInterval(pollInterval);
                            console.warn('[VAC] Finger phase: detector init timed out after ' + (MAX_POLLS * POLL_MS) + 'ms, using timer fallback');
                            runTimerFallback();
                        }
                    }, POLL_MS);
                }
            }, GRACE_MS);
        } else {
            // F-563: single greeting renderer for both the reading window AND the listening state
            // (and the "✓ Heard it" beat) — replaces the old second-class text block.
            renderGreeting();
        }
    }, TICK_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// F-662: shared co-occurrence gate for the bound digit ("show N AND say N together").
// EXTRACTED from beginRecording's full/light finger phase so the FAST tier
// (beginStillCapture) reuses the SAME advance timing instead of capturing on
// finger-steadiness ALONE — the S122 false-deny, where _audioRec.stop() fired before
// the user finished speaking → clipped spokenAudioB64 → server spoken_ok=false on a
// CORRECT attempt. Pacing only — the server stays the authoritative spoken-digit check.
// ─────────────────────────────────────────────────────────────────────────────
// Co-occurrence window (moved here from beginRecording — ONE source, used by BOTH tiers).
const DIGIT_COOCCUR_MS = 700;      // after a sustained-voice fire the FINGERS must come up within this window (fingers-up at the spoken timestamp → strong temporal binding). Covers both orders (gesture-held-then-voice = instant; voice-led-then-fingers = up to this long). PACING only — server does the authoritative fingers-at-timestamp check. LIVE-TUNE.
const DIGIT_COOCCUR_MAX_MS = 2000; // absolute cap from the voice fire to advance, EVEN while a hand stays in frame — so a number said over an unstable/wrong hand held past the window can't advance on the stale utterance after a late silent settle (adversarial-review/Codex). Generous enough to cover the stable-dwell + finger-count flicker (no livelock), tight enough to bound the window. LIVE-TUNE.

// The advance/expiry DECISION (pure). Reproduces beginRecording's inline gate exactly —
// expire a stale armed voice ONLY while the hand is genuinely DOWN past DIGIT_COOCCUR_MS
// (a voice-led user whose hand is up and merely settling does NOT expire → no livelock,
// adversarial-review F1), plus the absolute DIGIT_COOCCUR_MAX_MS cap; then advance on a
// live (stable, held) gesture AND still-armed voice co-occurring. speech-off (no mic) →
// gesture-only. Shared so the LIVE full path and the FAST tier define "may advance" identically.
//   o: { speechMode, voiceArmed, voiceFiredAt, liveGestureOk, now, handDown, escapePending }
//   → { advance, expireVoice }  (expireVoice=true: caller clears its armed voice flag → re-say)
function _cooccurAdvanceDecision(o) {
    var since = o.now - o.voiceFiredAt;
    var expireVoice = (o.speechMode !== 'off' && o.voiceArmed
        && ((o.handDown && since > DIGIT_COOCCUR_MS)   // hand DOWN, fingers never came up promptly → re-say
            || since > DIGIT_COOCCUR_MAX_MS));         // absolute cap regardless of hand → bounds the window
    var armedAfter = expireVoice ? false : o.voiceArmed;
    var voiceCo = (o.speechMode === 'off') ? true : armedAfter;
    var advance = (o.liveGestureOk && voiceCo) || (o.escapePending && o.liveGestureOk);
    // S429: REASON is additive instrumentation only — advance/expireVoice (the actual gate
    // decision, read by both tiers) are computed exactly as before, above. This just names WHY
    // a beat didn't advance instead of leaving it to be guessed after the fact (Rob's "Hello? 3.
    // 3. 3. 4." run against expected "3 4 1" had no non-advance reason recorded on the beat that
    // repeated — only the transcript and a finger count to reconstruct one from afterward).
    // expireVoice is checked FIRST: the hand-down expiry condition above (handDown && since >
    // DIGIT_COOCCUR_MS) means liveGestureOk is necessarily false at the moment it fires too, so
    // checking the generic "neither ready" case first would swallow the specific, more useful
    // expiry diagnosis on almost every expiry beat (codex adversarial review).
    var reason = advance ? 'advance'
        : expireVoice ? 'voice_cooccur_expired'
        : (!o.liveGestureOk && !voiceCo) ? 'gesture_and_voice_not_ready'
        : (!o.liveGestureOk) ? 'awaiting_gesture'
        : 'awaiting_voice';
    return { advance: advance, expireVoice: expireVoice, reason: reason };
}

// S155 POSITIVE-EVIDENCE FLOOR — voice (D-VERDICT-COMPOSITION companion). The FIRE conditions on
// both paths already require a wall-clock duration (DIGIT_VOICE_MIN_MS / FAST_DIGIT_VOICE_MIN_MS)
// AND a modulation swing — but duration is a TIMESTAMP DELTA, not a count of frames actually
// observed above threshold: on a stalled/throttled tab (backgrounded rAF, GC pause) a single wide
// gap between two above-threshold samples can satisfy a duration floor with very little real
// evidence. This is an INDEPENDENT floor, ANDed alongside the existing checks (never a substitute
// for them): the run must contain at least this many individual frames actually read above
// vadSpeechThreshold. One shared constant, both paths (D-VAD-GATE-FORK: identical value at both
// call sites — no drift possible, so it does not need a fork-guard pair like the ms/mod constants
// below do). ~8 frames is ~130-270ms of real above-threshold samples at typical 30-60fps rAF
// cadence — comfortably under the existing ms floors, so it tightens against timer gaps without
// becoming the binding constraint on a normal digit.
const VOICE_EVIDENCE_MIN_FRAMES = 8;

// FAST-tier voice arming. A single-window LIFT of beginRecording's _startSpeechGate VAD
// core (sustained ≥ voiceMinMs, modulated ≥ modDelta, FRESH silence→voice onset, dip-
// tolerant ≤ gapMs) — the SAME on-device energy gate, scoped to ONE bound digit (no
// per-digit array, no _markSpeech/_speechMode/coaching state). It reads a standalone
// analyser (startAudioMonitor's mic tap), so it never touches the clip flow. The LIVE
// full path keeps its own inline _startSpeechGate (F-662 risk call, codex: don't refactor
// the shipping VAD); these FAST_* constants MIRROR that inline tuning (kept separate on
// purpose). Pacing only — the server (Deepgram) is the authoritative spoken-digit check.
const FAST_VAD_SPEECH_RMS = 0.085;   // task-644: 0.115→0.085 for time-domain RMS scale (mirrors VAD_SPEECH_RMS_FALLBACK). Fast tier has no greeting cal; this IS the threshold.
const FAST_VAD_SILENCE_RMS = 0.030;  // task-644: 0.085→0.030 for time-domain scale. Mirrors VAD_SILENCE_RMS_FALLBACK.
const FAST_DIGIT_VOICE_MIN_MS = 270; // S154: propagate the S145j field-tune (350→270) that reached only the full path — quick-auth kept rejecting a briskly-said digit the full path had already learned to accept. Mirrors DIGIT_VOICE_MIN_MS.
const FAST_DIGIT_MOD_DELTA = 0.030;  // the voiced run's rms must vary at least this much — a flat tone/beep (~0 range) can't satisfy. Mirrors DIGIT_MOD_DELTA.
const FAST_DIGIT_VOICE_GAP_MS = 200; // max sustained OBSERVED dip within one voiced run before the run breaks (spaced taps). Mirrors DIGIT_VOICE_GAP_MS.
const FAST_VAD_ONSET_SUSTAIN_MS = 180; // S154 field-tune: mirrors VAD_ONSET_SUSTAIN_MS 250→180 (see full-path comment — normal-speech soft onsets were rejected).
const FAST_VAD_VOICE_BAND_FRAC = 0.35; // S139-v2: mirrors VAD_VOICE_BAND_FRAC — mid-band 300-3500Hz fraction >= 0.35; band narrowed from 0-3.5kHz to exclude LF tap thump. See full-path constant comment.
function _makeQuickReauthVoiceGate(cfg) {
    var speechThr = cfg.speechThr, silenceThr = cfg.silenceThr;
    var voiceMinMs = cfg.voiceMinMs, modDelta = cfg.modDelta, gapMs = cfg.gapMs;
    var _expectedDigit = (cfg.expectedDigit != null) ? cfg.expectedDigit : null;
    var _armed = false, _firedAt = 0, _windowStart = 0, _raf = null, _stopped = false;
    var _fastContentGate = null;  // D-VOICE-GATE-SPEAKER-AGNOSTIC: content gate for fast tier
    var voiced = 0, vMin = 1, vMax = 0, dipStart = 0, onsetAt = 0, sawSilence = false;
    var voicedFrames = 0;   // S155: mirrors full-path _voicedAboveThrFrames — VOICE_EVIDENCE_MIN_FRAMES floor
    var preOnsetStart = 0;       // S139: perf.now() when continuous above-threshold pre-onset began; reset on any non-above-threshold frame
    var preOnsetDipStart = 0;    // S154: tolerated pre-onset dip start (mirrors full path)
    var _sampLastT = 0, _sampMax = 0;  // S154 sampler state
    var preOnsetMidChecked = false;  // S139-v2: true once the mid-window spectral re-check has run in this pre-onset window
    var _fastTdBuf = null;           // task-644: time-domain buffer for RMS (lazy-init on first _loop call)
    function _loop(analyser, buf) {
        if (_stopped) { _raf = null; return; }
        if (!_fastTdBuf) _fastTdBuf = new Uint8Array(analyser.fftSize);  // task-644: lazy init
        try {
            // task-644: time-domain RMS for iOS compatibility; buf keeps freq data for spectral checks
            analyser.getByteTimeDomainData(_fastTdBuf);
            var rms = 0; for (var i = 0; i < _fastTdBuf.length; i++) { var _fv = _fastTdBuf[i] - 128; rms += _fv * _fv; }
            rms = Math.sqrt(rms / _fastTdBuf.length) / 128;
            analyser.getByteFrequencyData(buf);
            // S145 finding 5 (F-922 lock-step): the fast/quick-auth single-digit tier runs this
            // VAD but never showed the mic instrument. Arm the same overlay every speaking surface uses.
            window.__vacGateArmed = true;
            var now = performance.now();
            // S154 SCOPE FIX (root cause of months-dead quick-auth voice): _micPillDraw is
            // defined INSIDE beginRecording() — out of scope here at file level — so this
            // call threw a ReferenceError EVERY FRAME since S145, silently eaten by the
            // catch below; the sampler and the ENTIRE gate never executed. Cosmetic call is
            // now typeof-guarded and moved AFTER the gate logic; sampler runs first.
            try { if (typeof _micPillDraw === 'function') _micPillDraw(rms, speechThr, 'q'); } catch(_){}
            // S154 SAMPLER (zero fast vad_gate events across 3 failed quick-auths = the gate
            // never even started a run; only live state distinguishes never-silent vs
            // onset-aborting vs tick-dead). 1.5s cadence, window-max level, full gate state.
            _sampMax = Math.max(_sampMax, rms);
            if (now - _sampLastT >= 1500) {
                try { vacDebug('vad_gate', 'fast_sample', { path:'fast', rms_now: Number(rms.toFixed(3)), rms_max: Number(_sampMax.toFixed(3)), thr: Number(speechThr.toFixed(3)), sil: Number(silenceThr.toFixed(3)), saw_sil: !!sawSilence, voiced: voiced, pre_onset: preOnsetStart !== 0 }); } catch(_){}
                _sampLastT = now; _sampMax = 0;
            }
            if (rms < silenceThr) {
                preOnsetStart = 0; preOnsetMidChecked = false; preOnsetDipStart = 0;  // S139: silence aborts pre-onset (S154: dip tracker cleared)
                sawSilence = true;
                if (voiced > 0) { _vadDiag('run ended: ' + Math.round(now - onsetAt) + 'ms pk ' + (vMax*100).toFixed(0) + '% | need ' + voiceMinMs + 'ms above ' + (speechThr*100).toFixed(0) + '%'); try { vacDebug('vad_gate', 'run_ended', { path:'fast', dur_ms: Math.round(now - onsetAt), peak: Number(vMax.toFixed(3)), thr: Number(speechThr.toFixed(3)), need_ms: voiceMinMs }); } catch(_){} }  // S154 diag
                voiced = 0; vMin = 1; vMax = 0; dipStart = 0; voicedFrames = 0;   // real silence fully ends the run
            } else if (rms > speechThr) {
                voicedFrames++;   // S155: every above-threshold sample this attempt, pre-onset included
                if (voiced === 0) {
                    // S139 onset gate: require SUSTAINED above-threshold for FAST_VAD_ONSET_SUSTAIN_MS.
                    if (sawSilence) {
                        if (preOnsetStart === 0) {
                            // First frame: mid-band 300-3500Hz spectral check (same buf, zero latency).
                            // LF tap thumps (sub-200Hz) are excluded from the mid-band window.
                            var _fsr = (analyser.context && analyser.context.sampleRate) || 48000;
                            var _fmbStart = Math.ceil(300 * analyser.fftSize / _fsr);
                            var _fmbEnd   = Math.floor(3500 * analyser.fftSize / _fsr);
                            var _fmbSum = 0, _ftotSum = 1;
                            for (var _fsi = 0; _fsi < buf.length; _fsi++) { _ftotSum += buf[_fsi]; if (_fsi >= _fmbStart && _fsi <= _fmbEnd) _fmbSum += buf[_fsi]; }
                            if (_fmbSum / _ftotSum >= FAST_VAD_VOICE_BAND_FRAC) {
                                preOnsetStart = now; preOnsetMidChecked = false;  // voice-like mid-band; start sustain window
                            }
                            // else: LF-heavy transient — don't start pre-onset
                        } else if ((preOnsetDipStart = 0) || (now - preOnsetStart >= FAST_VAD_ONSET_SUSTAIN_MS)) {
                            onsetAt = preOnsetStart;  // backdate to actual start
                            vMin = rms; vMax = rms; voiced = 1;
                            preOnsetStart = 0; preOnsetMidChecked = false;
                        } else if (!preOnsetMidChecked && (now - preOnsetStart) >= FAST_VAD_ONSET_SUSTAIN_MS * 0.5) {
                            // Mid-window spectral re-check (~125ms in): catches a second desk-tap
                            // that arrives mid-window and shifts energy to LF-broadband.
                            var _fsr2 = (analyser.context && analyser.context.sampleRate) || 48000;
                            var _fmb2Start = Math.ceil(300 * analyser.fftSize / _fsr2);
                            var _fmb2End   = Math.floor(3500 * analyser.fftSize / _fsr2);
                            var _fmb2Sum = 0, _ftot2Sum = 1;
                            for (var _fsi2 = 0; _fsi2 < buf.length; _fsi2++) { _ftot2Sum += buf[_fsi2]; if (_fsi2 >= _fmb2Start && _fsi2 <= _fmb2End) _fmb2Sum += buf[_fsi2]; }
                            if (_fmb2Sum / _ftot2Sum >= FAST_VAD_VOICE_BAND_FRAC) {
                                preOnsetMidChecked = true;  // mid-window passed; continue accumulating
                            } else {
                                preOnsetStart = 0; preOnsetMidChecked = false;  // broadband double-tap — abort onset (no _rejectedTransients in fast path)
                            }
                        }
                    }
                } else {
                    voiced++; if (rms < vMin) vMin = rms; if (rms > vMax) vMax = rms;
                }
                dipStart = 0;
                if (voiced > 0 && now >= _windowStart
                    && (now - onsetAt) >= voiceMinMs && (vMax - vMin) >= Math.max(0.012, 0.10 * vMax)
                    && voicedFrames >= VOICE_EVIDENCE_MIN_FRAMES) {  // S154: relative modulation (see full-path comment); S155: frame floor
                    _vadDiag('FIRED: ' + Math.round(now - onsetAt) + 'ms pk ' + (vMax*100).toFixed(0) + '% thr ' + (speechThr*100).toFixed(0) + '%'); try { vacDebug('vad_gate', 'fired', { path:'fast', content_gated: _contentGateAvail && _expectedDigit != null, dur_ms: Math.round(now - onsetAt), peak: Number(vMax.toFixed(3)), thr: Number(speechThr.toFixed(3)) }); } catch(_){}  // S154 diag
                    // D-VOICE-GATE-SPEAKER-AGNOSTIC: energy alone is NOT a progression signal.
                    if (_contentGateAvail && _expectedDigit != null) {
                        // Energy heard — health indicator. Content gate fires _armed when matched.
                        if (!_fastContentGate) {
                            _fastContentGate = _startDigitContentGate(_expectedDigit, function() { _fastContentGate = null; _armed = true; _firedAt = performance.now(); });
                            if (!_fastContentGate) { _armed = true; _firedAt = now; }  // runtime null → energy fallback
                        }
                    } else {
                        _armed = true; _firedAt = now;  // energy fallback (no content gate)
                    }
                    voiced = 0; vMin = 1; vMax = 0; sawSilence = false; voicedFrames = 0;         // consumed; a NEW silence re-arms
                }
            } else {
                // neither band
                if (voiced > 0 && now >= _windowStart
                    && (now - onsetAt) >= voiceMinMs && (vMax - vMin) >= Math.max(0.012, 0.10 * vMax)
                    && voicedFrames >= VOICE_EVIDENCE_MIN_FRAMES) {  // S154: dip-frame fire evaluation (mirrors full path — see comment there); S155: frame floor
                    _vadDiag('FIRED(dip): ' + Math.round(now - onsetAt) + 'ms pk ' + (vMax*100).toFixed(0) + '%'); try { vacDebug('vad_gate', 'fired', { path:'fast', on:'dip', content_gated: _contentGateAvail && _expectedDigit != null, dur_ms: Math.round(now - onsetAt), peak: Number(vMax.toFixed(3)) }); } catch(_){}
                    if (_contentGateAvail && _expectedDigit != null) {
                        if (!_fastContentGate) {
                            _fastContentGate = _startDigitContentGate(_expectedDigit, function() { _fastContentGate = null; _armed = true; _firedAt = performance.now(); });
                            if (!_fastContentGate) { _armed = true; _firedAt = now; }  // runtime null → energy fallback
                        }
                    } else {
                        _armed = true; _firedAt = now;
                    }
                    voiced = 0; vMin = 1; vMax = 0; sawSilence = false; voicedFrames = 0;
                }
                if (preOnsetStart) {  // S154: tolerate brief observed dips within pre-onset (mirrors full path); sustained dip (>60ms) aborts
                    if (preOnsetDipStart === 0) preOnsetDipStart = now;
                    else if (now - preOnsetDipStart > 60) { preOnsetStart = 0; preOnsetMidChecked = false; preOnsetDipStart = 0; }
                }
                if (voiced > 0) {
                    if (!dipStart) dipStart = now;
                    else if (now - dipStart > gapMs) { voiced = 0; vMin = 1; vMax = 0; dipStart = 0; voicedFrames = 0; }  // sustained dip kills the run
                }
            }
        } catch(_e) {
            // S154: a per-frame exception here is a DEAD GATE wearing a running loop's
            // clothes (the months-dead scope bug hid exactly this way). Report, throttled.
            var _en = performance.now();
            if (_en - _sampLastT >= 3000) { _sampLastT = _en; try { vacDebug('vad_gate', 'fast_loop_error', { path:'fast', err: String(_e && _e.message || _e).slice(0,120) }); } catch(_){} }
        }
        _raf = requestAnimationFrame(function(){ _loop(analyser, buf); });
    }
    return {
        start: function(analyser) {
            if (_raf || _stopped || !analyser) return;
            _windowStart = performance.now();
            _loop(analyser, new Uint8Array(analyser.frequencyBinCount));
        },
        stop: function() {
            _stopped = true;
            if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
            // D-VOICE-GATE-SPEAKER-AGNOSTIC: stop content gate
            if (_fastContentGate) { _fastContentGate.stop(); _fastContentGate = null; }
        },
        clearArm: function() { _armed = false; },
        get armed() { return _armed; },
        get firedAt() { return _firedAt; }
    };
}

// D-QUICKAUTH-MIC-COLD-START: dedicated silent calibration window before the speak prompt.
// Root cause: AudioContext starts suspended on user-gesture paths in some browsers; the gate
// armed (and the prompt showed) while context was still suspended, so the analyser returned
// zeros for the first ~50-300ms. Rob's first utterance began before context resumed → the
// onset sustain window never saw enough above-threshold frames → first attempt always lost.
// Fix: hold "Preparing mic…" and poll until context is provably 'running', then collect a
// dedicated silent window so the EMA floor settles before the gate arms. The speak prompt
// shows ONLY after this resolves. No user speech is consumed by the calibration window.
const MIC_READY_CAL_MS = 400;       // silent floor-calibration window (EMA settles, ~24 rAF frames at 60 fps)
const MIC_READY_TIMEOUT_MS = 2000;  // bail-out ceiling — permanent suspension is unrecoverable
// analyser param reserved for future analyser-data calibration; current calibration is time-based
// (EMA floor settles passively via startAudioMonitor's updateLevels rAF loop — no explicit read needed here).
function _awaitMicReady(ctx, analyser, calMs) {  // eslint-disable-line no-unused-vars
    return new Promise(function(resolve) {
        var _t0 = performance.now();
        var _deadline = _t0 + MIC_READY_TIMEOUT_MS;
        var _calStart = 0;
        var _resumeRequested = false;  // one-shot: avoid repeated ctx.resume() (iOS WebKit bug — multiple pending resumes can lock state)
        // Instrument the wait for field diagnosis (L-2173: one runtime datum beats code-reading).
        try { vacDebug('mic_ready_wait_start', null, {
            ctx_state: ctx ? ctx.state : 'null',
            stream_active: (typeof mediaStream !== 'undefined' && mediaStream) ? mediaStream.active : null,
            audio_track: (typeof mediaStream !== 'undefined' && mediaStream && mediaStream.getAudioTracks().length)
                         ? mediaStream.getAudioTracks()[0].readyState : 'none',
            cal_ms: calMs
        }); } catch(_) {}
        function _tick(tsNow) {
            var now = (typeof tsNow === 'number' && tsNow > 0) ? tsNow : performance.now();
            if (now >= _deadline) {
                try { vacDebug('mic_ready_timeout', null, { elapsed_ms: Math.round(now - _t0), ctx_state: ctx ? ctx.state : 'null' }); } catch(_) {}
                resolve(); return;
            }
            if (!ctx || ctx.state === 'closed') { resolve(); return; }  // AudioContext closed (session teardown) — no point waiting
            if (ctx.state !== 'running') {
                if (ctx.state === 'suspended' && !_resumeRequested) {
                    _resumeRequested = true;  // one-shot: don't hammer resume() — iOS WebKit 17 bug with multiple concurrent resumes
                    try { ctx.resume().then(function(){ _resumeRequested = false; }).catch(function(){ _resumeRequested = false; }); } catch(_) { _resumeRequested = false; }
                }
                requestAnimationFrame(_tick); return;
            }
            if (_calStart === 0) {
                _calStart = now;
                try { vacDebug('mic_ready_ctx_running', null, { elapsed_ms: Math.round(now - _t0) }); } catch(_) {}
            }
            if (now - _calStart < calMs) { requestAnimationFrame(_tick); return; }
            try { vacDebug('mic_ready_done', null, {
                elapsed_ms: Math.round(now - _t0),
                floor: (typeof audioNoiseFloor !== 'undefined') ? Number(audioNoiseFloor.toFixed(4)) : null
            }); } catch(_) {}
            resolve();
        }
        requestAnimationFrame(_tick);
    });
}

// Recording complete → upload to backend for real verification
// F-624 Rung 2 (FAST capture): the lightweight counterpart to beginRecording — no
// MediaRecorder, no A/V clip. Grab ONE still from the live preview plus a single
// finger reading, then hand straight to runFastVerification. Reuses the EXACT
// still-canvas + FingerDetector machinery the full clip path uses, so the captured
// artefacts match what /v1/auth/quick-reauth expects. UNEXERCISED by auth.html (full
// only); the fast hosts (vat-verify / tribunal) flip it on via profile.mode='fast'
// in a later lane, where it gets live-tested with a real camera.
async function beginStillCapture() {
    try { vacDebug('begin_still_capture_called'); } catch(_) {}
    // F-671 Phase B1: ONE mount-scoped resolver for the WHOLE fast path (step2 + step3 reads/writes), so
    // every DOM lookup resolves INSIDE CTX.mount. Fast embeds CEREMONY_HTML into an arbitrary host
    // (tribunal/vat-verify) where a bare document.getElementById could hit a colliding host id; the FULL
    // path keeps document.getElementById (auth.html — the ceremony IS the page). Falls back to document
    // when there's no mount (defensive; run() bails earlier if CTX.mount is absent). The CaptureFeedback
    // ctx.byId below points here too, so #challengeText has exactly ONE resolution path (no double-write).
    const _scope = (CTX && CTX.mount) ? CTX.mount : document;
    const byId = function(id){ return _scope.querySelector('#' + id); };
    // F-666 #3 (codex P2): a PRIOR fast run's verdict may still occupy step3's progress area,
    // including a live #qrContinueBtn wired to that run's _finish(). If the user tapped "Start
    // over" instead of "Continue", goToStep(3) below would re-show that stale verdict and the
    // stale button could complete THIS restarted attempt on the PRIOR result. Restore the
    // pristine progress markup now (snapshotted in renderQuickReauthVerdict) so every capture
    // starts step3 clean. innerHTML replacement also drops the stale button + its onclick.
    // F-671 Phase B1: the step3 verdict/continue cluster stays DOCUMENT-GLOBAL on purpose. Its
    // #qrContinueBtn is WIRED in runFastVerification (a HELD verify-path fn this lane must not touch),
    // so renderQuickReauthVerdict's host + this restore stay document-global to MATCH it — scoping only
    // part of the trio would strand the __qrOrigHTML snapshot or mis-wire Continue. (This is the pre-B1
    // behavior; the step2 capture UI below IS mount-scoped, where every consumer is in-path. Full step3
    // collision-safety would need to scope the held runFastVerification too — a B2 / host-hardening lane.)
    try { var _pc0 = document.querySelector('#step3 .progress-container'); if (_pc0 && _pc0.__qrOrigHTML != null) { _pc0.innerHTML = _pc0.__qrOrigHTML; } } catch(_) {}
    let detectedFingers = null;
    let _fingerFailReason = null;   // F-672: set when NO valid finger count could be captured → fail-closed (never POST detected_fingers:null)
    let _gateEvidence = [];   // S145 finding 6: per-attempt {stage, detected_finger_count, expected_count, zone_in, attempt_n} — rendered on a client pre-gate fail-close so the user (and Rob) can see WHY, instead of a silent drop to onFallback
    let stillB64 = '';
    // F-637 (L-2224 scope fix): these are STAMPED inside the nested gesture-poll block but READ
    // below at capture time (outside that block). Declared at function scope so the reads resolve.
    let _pollStillTsMs = 0, _pollDetectedFingers = null;
    let faceEmbedding = null;   // F-637c: LIVE 128-D identity descriptor of THIS capture (single-face enforced)
    let spokenAudioB64 = '';    // F-654: the SPOKEN digit clip (Deepgram) — the 'said' half of the bound digit
    let stillTsMs = 0;          // offset of the bound still into the spoken clip (co-occurrence proof)

    // F-654 (COPS/PID-driven): the capture composition is read from the POLICY, never hardcoded.
    // The FAST tier's policy lists bound_digit = "spoken AND shown" — so this path captures BOTH a
    // finger count (MediaPipe) AND a short spoken-digit clip (Deepgram), co-occurring with the still.
    // If COPS/PID instead emits a gesture-only policy, _captureVoice goes false and no audio is
    // recorded — same code, different policy, NO fork. This stays the lightweight tier: still +
    // 128-D face-embedding euclidean match + Deepgram digit + Didit liveness, NO Gemini video sweep.
    const _policyReq = reauthPolicyRequired() || [];
    const _captureVoice = _policyReq.some(function(m){ return /bound_digit|voice|voiceprint|spoken/i.test(String(m)); });
    const _expectFingers = (challengeData && (typeof challengeData.fingers === 'number' ? challengeData.fingers
                            : (challengeData.digits && challengeData.digits.length ? challengeData.digits[0] : null)));
    // F-671 Phase B1: light presentation ctx — drives the SHARED CaptureFeedback.* show-and-say feedback
    // (the full path's per-digit UI: digit strip, big guided panel, live lamps, framing banner). Carries
    // NO advance-loop / MediaRecorder / Gemini state (presentation only). digits = [the single bound digit];
    // phraseDuration=0 so the phrase branch (the only reader of challengeData/fingerFallback/vacGreetingText
    // globals) never fires; digitDuration is a nonzero divisor guard (fast never calls updatePhasePrompt).
    // voiceless mirrors the gesture-only policy so the shared copy drops the "say it" half + hides the voice lamp.
    const ctx = {
        byId: byId,
        digits: [_expectFingers],
        phraseDuration: 0,
        digitDuration: 1,
        framingBadFrames: 0,
        voiceless: !_captureVoice,
    };
    // Start recording the spoken-digit audio ONLY when the policy's bound digit requires the spoken
    // half (COPS/PID decides — not this function). Same live mic track, no new getUserMedia.
    let _audioRec = null, _audioChunks = [], _audioStartMs = 0;
    // F-662: the FAST tier's voice-arming gate for the bound digit (single window). Null when the
    // policy is gesture-only (_captureVoice===false) or when no analyser can be brought up — both
    // cases fall back to the show-only finger-steady advance below (codex: degrade, never hang).
    let _voiceGate = null;
    if (_captureVoice) {
        try {
            const _atracks = mediaStream ? mediaStream.getAudioTracks() : [];
            if (_atracks && _atracks.length) {
                const _astream = new MediaStream([_atracks[0]]);
                _audioRec = new MediaRecorder(_astream);
                _audioRec.ondataavailable = function(e){ if (e.data && e.data.size) _audioChunks.push(e.data); };
                _audioRec.start();
                _audioStartMs = performance.now();
            }
        } catch(ae) { console.warn('[VAC] quick-reauth audio record start failed (non-fatal):', (ae && ae.message) || ae); }
        // D-QUICKAUTH-MIC-COLD-START: show honest state while waiting for AudioContext + floor.
        // The real "Show your fingers and say the number" prompt is rendered below ONLY after
        // _awaitMicReady resolves — this label is what the user sees during the calibration window.
        try { var _t2prep = byId('step2Title'); if (_t2prep) { _t2prep.textContent = 'Preparing mic…'; _t2prep.style.color = '#fbbf24'; } } catch(_) {}
        // F-662: tap a STANDALONE analyser (startAudioMonitor's mic clone — independent of the clip
        // MediaRecorder, so the lightweight contract is untouched) so the poll loop can gate capture on
        // the spoken digit CO-OCCURRING with the gesture, instead of stopping _audioRec mid-utterance
        // (the S122 false-deny). If the analyser can't come up, _voiceGate stays null → show-only advance.
        try {
            startAudioMonitor();
            if (audioAnalyser) {
                // D-QUICKAUTH-MIC-COLD-START: wait for AudioContext running + dedicated 400ms floor-
                // calibration window before arming the gate. This is the core fix: the race was that
                // AudioContext started suspended, the gate armed (and the speak prompt showed) before
                // context resumed, so Rob's first utterance was swallowed by a deaf analyser returning
                // zeros. The await holds "Preparing mic…" until context is provably running and the EMA
                // floor has settled over a silent window — the gate arms on a real floor, not 0.01 seed.
                // No user speech is consumed: the calibration window ends before the prompt shows.
                try { await _awaitMicReady(audioContext, audioAnalyser, MIC_READY_CAL_MS); } catch(_) {}
                // Ghost-session guard: VACReauth.cancel() → stopAudioMonitor() → audioAnalyser=null.
                // If that fired during the await window, abort — don't arm the gate or run the POST.
                if (!audioAnalyser) { return; }
                // D-VAD-CALIBRATION-GREETING-BOUND: the fast tier has no greeting to calibrate off
                // at all (comment on FAST_VAD_SPEECH_RMS above says so directly) — it's PURELY the
                // fallback constants today. This tier also has a preflight (startAVChecks) ahead of
                // it in the same page session, so arm from the same preflight-derived thresholds the
                // full tier now uses, falling back to the FAST_VAD_* constants only if preflight
                // measurements never landed.
                // S155 PER-SPEAKER FAST CAL: when the preflight never measured a usable speech
                // sample (common on the fast tier — no greeting), fall to the SHARED
                // _fastCalThreshold(audioNoiseFloor) helper (same function the full tier calls
                // above) before the flat FAST_VAD_* constants. audioNoiseFloor is already rolling
                // by this point (startAudioMonitor() + _awaitMicReady just finished, above).
                const _fastVad = _micPreflightVad();
                const _fastRollingThr = _fastVad ? null : _fastCalThreshold(audioNoiseFloor);
                const _fastSpeechThr = _fastVad ? _fastVad.speechThr : (_fastRollingThr != null ? _fastRollingThr : FAST_VAD_SPEECH_RMS);
                const _fastSilenceThr = _fastVad ? _fastVad.silenceThr : (_fastRollingThr != null ? _calClamp(audioNoiseFloor + _CAL_SIL_K * (_fastRollingThr - audioNoiseFloor), 0.03, _fastRollingThr) : FAST_VAD_SILENCE_RMS);
                // D-VAD-UNITS (task-447): floor/speech are ceremony-RMS-scale; floor_pct/speech_pct
                // carry the raw time-domain preflight samples alongside for direct field verification.
                try { vacDebug('vad_calibrated', null, { at: 'arm', tier: 'fast', floor: _fastVad ? Number(_fastVad.floor.toFixed(3)) : (_fastRollingThr != null ? Number(audioNoiseFloor.toFixed(3)) : null), speech: _fastVad ? Number(_fastVad.speech.toFixed(3)) : null, floor_pct: _micSeededAmbient ? Number(_micSeededAmbient.toFixed(1)) : null, speech_pct: _micSeededSpeechLevel ? Number(_micSeededSpeechLevel.toFixed(1)) : null, thr: Number(_fastSpeechThr.toFixed(3)), sil: Number(_fastSilenceThr.toFixed(3)), fallback: !_fastVad, reason: _fastVad ? null : _micPreflightVadReason, source: _fastVad ? 'preflight' : (_fastRollingThr != null ? 'rolling_floor' : 'fallback') }); } catch(_) {}
                _voiceGate = _makeQuickReauthVoiceGate({
                    speechThr: _fastSpeechThr, silenceThr: _fastSilenceThr,
                    voiceMinMs: FAST_DIGIT_VOICE_MIN_MS, modDelta: FAST_DIGIT_MOD_DELTA, gapMs: FAST_DIGIT_VOICE_GAP_MS,
                    expectedDigit: _expectFingers  // D-VOICE-GATE-SPEAKER-AGNOSTIC: content gate target
                });
                _voiceGate.start(audioAnalyser);
            } else {
                try { vacDebug('fast_reauth_voice_gate', 'no_analyser_show_only'); } catch(_) {}
            }
        } catch(ve) { _voiceGate = null; console.warn('[VAC] quick-reauth voice gate start failed (non-fatal, show-only):', (ve && ve.message) || ve); }
    }
    try {
        const _gv = byId('videoPreviewRec') || byId('videoPreview');
        // F-671 Phase B1 (codex P2): goToChallenge attaches mediaStream to document.getElementById
        // ('videoPreviewRec') — shared full-path setup we must NOT touch. On an embedded host with a
        // colliding id that may NOT be the element this mount-scoped lookup returns, the mounted video
        // would keep videoWidth=0 (still/embedding skipped → needless fallback). Idempotently ensure
        // THIS (mounted) recorder video carries the live stream; a no-op in the normal no-collision case.
        try { if (_gv && mediaStream && _gv.srcObject !== mediaStream) { _gv.srcObject = mediaStream; _gv.muted = true; _gv.setAttribute('playsinline',''); _gv.play().catch(function(){}); } } catch(_) {}
        // S154 REVERTED (Rob): the video-only constraint broke registration with the zone/skeleton
        // overlay canvas (drawn against raw video dims) — video crossed the oval. Cosmetic sizing
        // must resize video+canvas as a UNIT; parked to the zone lane (F-1028) where that geometry
        // is already in scope. Do not re-attempt element-only styling here.
        if (_gv && _expectFingers != null) {
            // F-671 Phase B1: render the show-and-say feedback through the SHARED CaptureFeedback.* (the
            // full path's UI) instead of the old minimal inline #challengeText. renderDigitStrip ONCE (one
            // bound digit → one progress dot that never changes index); renderFingerPhase owns the
            // #challengeText header; renderGuided shows the big guided panel + live lamps (driven per-tick
            // in the loop below). step2 title via byId (mount-scoped, same resolver as every fast lookup).
            try {
                // F-671 Phase B1 (codex P3): clear any sticky display:none the voice sub-gate may carry from a
                // PRIOR gesture-only attempt in this (reused) mount — else a voiced challenge updates the lamp
                // but the box stays hidden. renderGuided's voiceless branch re-hides it per tick when needed.
                try { var _vv0 = byId('vacGuidedVoice'); if (_vv0) _vv0.style.display = ''; } catch(_) {}
                CaptureFeedback.renderDigitStrip(ctx, 0);
                CaptureFeedback.renderFingerPhase(ctx, false, 0);
                CaptureFeedback.renderGuided(ctx, { digit: _expectFingers, voiceOn: !!_voiceGate, voiceDone: false, handNear: false, gestureLive: false, coachKey: '', voiceHelp: false });
                var _t2 = byId('step2Title'); if (_t2) { _t2.textContent = _captureVoice ? 'Show your fingers and say the number' : 'Show your fingers'; _t2.style.color = '#fbbf24'; }
            } catch(_) {}
            // Poll for a STABLE matching finger count. Reuse FingerDetector (same as the full phase)
            // + draw the skeleton for the same feel. Grace window = fail-open backstop (face+liveness
            // remain the server gate; the gesture is advisory pacing, mirroring the clip path).
            const _GEST_MAX_MS = 6000, _GEST_TICK = 120, _STABLE_NEEDED = 4, _FINGER_MAX_RETRY = 2;
            // F-637 co-occur fix: stamp stillTsMs and detectedFingers at the exact advance
            // moment — before the 350ms UX beat — so the timestamp lands mid-utterance, not
            // 350ms+embedding_time later in silence. _pollDetectedFingers avoids the post-beat
            // FingerDetector.detect() re-read that can race with hand-down on settle.
            // (Declared at function scope above — L-2224 — so the capture-time reads resolve.)
            _pollStillTsMs = 0; _pollDetectedFingers = null;
            var _fastHandZoneLastState = null;  // task-432 Part 4: transition telemetry for this attempt
            var _fastHandZoneSnapLastT = 0;    // task-handzone-faceanchored: throttle fast-tier zone snapshot
            // F-637: minimum audio window for the gesture-only fallback (voice required but
            // _voiceGate = null). Without this, stable-gesture fires at ~480ms before the
            // user speaks, leaving stillTsMs in pre-speech silence. 800ms ensures the audio
            // has captured the start of the utterance before the still is taken.
            const _MIN_AUDIO_BEFORE_CAPTURE_MS = 800;
            // F-672: bounded coach-retry around the co-occurrence poll. Each window resolves the STABLE
            // count (>=0) on advance, or null on timeout (NO capture-anyway). No-hand → coach + re-poll
            // (MAX 2); down detector → fail-closed, no retry; NEVER POST detected_fingers:null. The retry
            // re-runs the CLIENT poll only (no POST) so it can't consume the server step-up budget (F-673).
            for (var _fAttempt = 0; ; _fAttempt++) {
              var _polled = await new Promise(function(resolve){
                let _stable = 0, _waited = 0, _lastSeen = null;
                const _iv = setInterval(function(){
                    _waited += _GEST_TICK;
                    let _n = null;
                    try { _maybeUpdateFaceAnchor(_gv); } catch(_) {}   // task-432 Part 1: throttled face-anchor refresh
                    try { _n = FingerDetector.detect(_gv); } catch(_) {}
                    // F-654: draw the SAME hand skeleton as the full/seal finger phase (consistency,
                    // Rob) via the top-level shared drawer (the beginRecording one is out of scope).
                    // D-QUICKAUTH-ZONE-AFFORDANCE-LATE: call unconditionally so zone ovals pre-show
                    // before hand detection, matching the full-path's per-frame oval draw (L-2299).
                    // _drawFingerTargetGuide handles null lm gracefully: draws ovals, skips skeleton.
                    try { _drawHandSkeletonShared(_gv, FingerDetector.landmarks, _expectFingers); } catch(_) {}
                    // require the SAME count steady across consecutive ticks (not just presence)
                    if (typeof _n === 'number' && _n >= 0) {
                        if (_n === _lastSeen) _stable++; else _stable = 1;
                        _lastSeen = _n;
                    } else { _stable = 0; _lastSeen = null; }
                    // F-671 Phase B1: drive the SHARED guided panel + framing banner from THIS tick's live
                    // state (the same sensing the full path's finger phase renders). PURE PRESENTATION: it
                    // reads the loop's _n / _stable / landmarks / _voiceGate and writes only the #vacGuided
                    // panel + framing banner — it does NOT touch the capture gate below (_cooccurAdvanceDecision
                    // stays the sole advance authority). voiceHelp is intentionally dropped: the fast voice gate
                    // exposes no RMS/silence state, so "speak louder" can't be told apart from "hasn't spoken yet"
                    // — coachKey='gestureonly' ("say it out loud") carries the honest nudge instead.
                    var _lm = (typeof FingerDetector !== 'undefined') ? FingerDetector.landmarks : null;
                    var _handNear = !!_lm && _handNearFaceZone(_lm);
                    try { _fastHandZoneLastState = _noteHandZoneTransition(_fastHandZoneLastState, _handNear, _activeZone()); } catch(_) {}
                    // task-handzone-faceanchored: per-beat zone snapshot for the fast tier (~2s throttle)
                    try {
                        var _fSnapNow = performance.now();
                        if (_fSnapNow - _fastHandZoneSnapLastT >= 2000) {
                            _fastHandZoneSnapLastT = _fSnapNow;
                            var _fSnapZone = _activeZone();
                            var _fPcx = null, _fPcy = null, _fPalmIn = null, _fTips = 0;
                            if (_lm && _lm.length === 21) {
                                var _ffin = true;
                                for (var _ffi = 0; _ffi < 21 && _ffin; _ffi++) { if (!_lm[_ffi] || !Number.isFinite(_lm[_ffi].x) || !Number.isFinite(_lm[_ffi].y)) _ffin = false; }
                                if (_ffin) {
                                    var _fpc = { x: (_lm[5].x + _lm[9].x + _lm[13].x + _lm[17].x) / 4, y: (_lm[5].y + _lm[9].y + _lm[13].y + _lm[17].y) / 4 };
                                    _fPcx = +_fpc.x.toFixed(3); _fPcy = +_fpc.y.toFixed(3);
                                    _fPalmIn = _ptInCheekZone(_fpc);
                                    var _ftips = [4, 8, 12, 16, 20];
                                    for (var _fti = 0; _fti < _ftips.length; _fti++) { if (_ptInCheekZone(_lm[_ftips[_fti]])) _fTips++; }
                                }
                            }
                            vacDebug('hand_zone_snap', null, {
                                path: 'fast',
                                anchored: _fSnapZone.anchored,
                                rx: +_fSnapZone.rx.toFixed(3),
                                ry: +_fSnapZone.ry.toFixed(3),
                                ovals: _fSnapZone.ovals.map(function(o) { return { side: o.side, cx: +o.cx.toFixed(3), cy: +o.cy.toFixed(3) }; }),
                                palm_cx: _fPcx,
                                palm_cy: _fPcy,
                                palm_in_zone: _fPalmIn,
                                tips_in: _fTips,
                                hand_near: _handNear
                            });
                        }
                    } catch(_) {}
                    var _gestureLive = (_stable >= _STABLE_NEEDED && typeof _n === 'number' && _n > 0);
                    var _voiceDone = !!(_voiceGate && _voiceGate.armed);
                    var _coachKey = '';
                    if (!ctx.voiceless) {
                        if (_gestureLive && !_voiceDone) _coachKey = 'gestureonly';   // shown, not yet said
                        else if (_voiceDone && !_gestureLive) _coachKey = 'voiceonly'; // said, not yet shown
                    }
                    try { CaptureFeedback.renderGuided(ctx, { digit: _expectFingers, voiceOn: !!_voiceGate, voiceDone: _voiceDone, handNear: _handNear, gestureLive: _gestureLive, coachKey: _coachKey, voiceHelp: false }); } catch(_) {}
                    try { CaptureFeedback.checkHandFraming(ctx, _lm); } catch(_) {}
                    // F-662/F-637 capture gate. Three branches:
                    // 1. _voiceGate live: co-occurrence (voice onset AND stable gesture) via
                    //    _cooccurAdvanceDecision — expireVoice clears a stale arm.
                    // 2. _captureVoice + no gate (VAD unavailable): gate on _MIN_AUDIO_BEFORE_CAPTURE_MS
                    //    so the audio window contains the utterance before the still is taken.
                    // 3. Gesture-only policy (_captureVoice=false): unchanged show-only steadiness.
                    var _captureNow;
                    if (_voiceGate) {
                        var _g = _cooccurAdvanceDecision({
                            speechMode: 'vad',
                            voiceArmed: _voiceGate.armed,
                            voiceFiredAt: _voiceGate.firedAt,
                            liveGestureOk: (_stable >= _STABLE_NEEDED && typeof _n === 'number' && _n > 0),
                            now: performance.now(),
                            handDown: (typeof _n !== 'number' || _n <= 0),
                            escapePending: false
                        });
                        if (_g.expireVoice) _voiceGate.clearArm();
                        _captureNow = _g.advance;
                    } else if (_captureVoice) {
                        // F-637: voice required, gate unavailable. Gate on minimum audio elapsed
                        // so stillTsMs stays within the utterance for users who show+say together.
                        // If audio never started (_audioStartMs=0, recorder threw), default elapsed
                        // to _MIN_AUDIO_BEFORE_CAPTURE_MS so we fall back to gesture-only and
                        // avoid an 18-second livelock (3 × 6s timeout) for this dual-failure path.
                        var _audioElapsed = _audioStartMs ? (performance.now() - _audioStartMs) : _MIN_AUDIO_BEFORE_CAPTURE_MS;
                        _captureNow = (_stable >= _STABLE_NEEDED) && (typeof _n === 'number' && _n > 0) && (_audioElapsed >= _MIN_AUDIO_BEFORE_CAPTURE_MS);
                    } else {
                        _captureNow = (_stable >= _STABLE_NEEDED);   // gesture-only policy: unchanged
                    }
                    if (_captureNow) {
                        // F-637: stamp at co-occurrence moment, before the 350ms UX beat.
                        // The beat is visual-only; server needs stillTsMs to overlap the
                        // utterance window, not land in the post-utterance silence.
                        _pollStillTsMs = (_captureVoice && _audioStartMs) ? Math.round(performance.now() - _audioStartMs) : 0;
                        _pollDetectedFingers = (typeof _n === 'number' && _n >= 0) ? _n : _lastSeen;
                        try { vacDebug('fast_cooccur_advance', null, { still_ts_ms: _pollStillTsMs, detected_fingers: _pollDetectedFingers, voice_gate: !!_voiceGate, waited_ms: _waited }); } catch(_) {}
                        try { CaptureFeedback.renderGuided(ctx, { beat: true }); } catch(_) {}   // F-671 Phase B1: "Got it" beat now renders in the shared guided panel (full-path parity)
                        clearInterval(_iv); var _cap = _lastSeen; setTimeout(function(){ resolve(_cap); }, 350); return;  // F-672: resolve WITH the co-occurrence-gated stable count
                    }
                    if (_waited >= _GEST_MAX_MS) { clearInterval(_iv); resolve(null); }  // F-672: timeout → NO capture-anyway; null signals "no gesture" → the retry / fail-close logic decides
                }, _GEST_TICK);
              });
              if (typeof _polled === 'number' && _polled >= 0) { break; }   // co-occurrence advance confirmed → capture; _pollDetectedFingers stamped at advance (F-637)
              // no advance this window — classify via a raw read (camera still live, pre-teardown).
              var _rawFc = null; try { _rawFc = FingerDetector.detect(_gv); } catch(_) { _rawFc = null; }
              // S145 finding 6: record this attempt's evidence BEFORE deciding fail-close vs retry, so
              // a retry that also fails still leaves a trail (every attempt, not just the last one).
              try {
                  var _evLm = (typeof FingerDetector !== 'undefined') ? FingerDetector.landmarks : null;
                  _gateEvidence.push({
                      stage: (_rawFc === null ? 'detector_down' : (_rawFc < 0 ? 'no_hand' : 'unstable')),
                      detected_finger_count: _rawFc,
                      expected_count: _expectFingers,
                      zone_in: !!_evLm && _handNearFaceZone(_evLm),
                      attempt_n: _fAttempt + 1
                  });
              } catch(_) {}
              if (_rawFc === null || (typeof FingerDetector !== 'undefined' && FingerDetector.failed)) { _fingerFailReason = 'finger_detector_down'; break; }   // null → detector down: retry can't recover → fail-closed, NO retry
              if (_fAttempt >= _FINGER_MAX_RETRY) { _fingerFailReason = 'no_finger_after_retry'; break; }   // -1 no hand, retries exhausted → fail-closed
              try { CaptureFeedback.renderGuided(ctx, { digit: _expectFingers, voiceOn: !!_voiceGate, voiceDone: false, handNear: false, gestureLive: false, coachKey: '', voiceHelp: false }); } catch(_) {}   // coachable retry via the shared feedback (camera live) → re-poll
            }
        }
    } catch (e) { console.warn('[VAC] fast gesture prompt failed (non-fatal):', (e && e.message) || e); }

    // F-672: defer the still + 128-D embedding (+ audio finalize) until a VALID finger count. On a
    // fail-close path (_fingerFailReason set) skip capture entirely — no wasted ~10s embedding, and the
    // still is never bound to a failed/absent gesture.
    if (!_fingerFailReason) {
    try {
        const v = byId('videoPreviewRec') || byId('videoPreview');
        if (v && v.videoWidth && v.videoHeight) {
            // F-637: prefer poll-time finger count (stamped at co-occurrence, no post-beat
            // race). Fall back to a live re-read only when the fail-open timer fired
            // (_pollDetectedFingers = null because no advance event ran).
            if (_pollDetectedFingers !== null) {
                detectedFingers = _pollDetectedFingers;
            } else {
                // Fail-open path: _GEST_MAX_MS timer fired, no co-occurrence stamped.
                try { var _fc = FingerDetector.detect(v); if (typeof _fc === 'number' && _fc >= 0) detectedFingers = _fc; else _fingerFailReason = _fingerFailReason || 'finger_lost_at_capture'; } catch(_) { _fingerFailReason = _fingerFailReason || 'finger_lost_at_capture'; }
            }
            // Bound still — same <=640px downscale + RAW (un-mirrored) capture as the clip path.
            const longest = Math.max(v.videoWidth, v.videoHeight);
            const scale = longest > 640 ? 640 / longest : 1;
            const cw = Math.max(1, Math.round(v.videoWidth * scale));
            const ch = Math.max(1, Math.round(v.videoHeight * scale));
            const c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').drawImage(v, 0, 0, cw, ch);
            // F-637/F-654: use the timestamp stamped at co-occurrence (poll-time), not now.
            // 'now' is 350ms+embedding_time later, potentially in post-utterance silence.
            // _pollStillTsMs = 0 on the fail-open path; fall back to performance.now() offset
            // which preserves the existing fail-open behavior.
            if (_pollStillTsMs > 0) {
                stillTsMs = _pollStillTsMs;   // co-occurrence timestamp (mid-utterance)
            } else if (_captureVoice && _audioStartMs) {
                stillTsMs = Math.round(performance.now() - _audioStartMs); // fallback: fail-open
            }
            const dataUrl = c.toDataURL('image/jpeg', 0.9);
            const comma = dataUrl.indexOf(',');
            if (comma !== -1) stillB64 = dataUrl.slice(comma + 1); // strip "data:image/jpeg;base64,"
            // F-637c: compute the LIVE 128-D face descriptor from the SAME captured still and send
            // it as face_embedding — without it the server fails quick-reauth at embedding_invalid
            // and the euclidean identity check (live vs stored enroll) never runs. Mirrors the FULL
            // clip path (onRecordingComplete) + the existing re-auth SDK (vac-auth.js). VACFaceEmbed
            // enforces single-face: ok:true ONLY for exactly one face with a valid 128-D vector;
            // 0 faces / >1 face / detector error → ok:false. compute() lazily awaits model load, so
            // a cold model waits; we cap that wait with a fail-closed timeout so a stalled model can
            // never strand the user (it routes to fallback instead). Computing from `c` keeps the
            // descriptor and the still_b64 pixel-identical. We await BEFORE building parts, so
            // buildBody can never read face_embedding before the descriptor resolves (no race).
            if (!_fingerFailReason && window.VACFaceEmbed && typeof window.VACFaceEmbed.compute === 'function') {
                // F-787a BEST-OF-N GRAB (S133/S134 telemetry: fast_reauth_embedding_failed:no_face —
                // ONE instant's frame decided everything; a slightly-turned/occluded face at that
                // instant fail-closed the whole attempt, so users had to compose like a passport
                // photo to pass). Resilience WITHOUT touching any threshold: if compute finds no
                // face in this frame, grab a FRESH frame from the still-live video (~300ms later)
                // and try again — up to 3 retries. The WINNING frame becomes BOTH the still and
                // the embedding source (re-encoded from the same canvas: descriptor and still stay
                // pixel-identical — the F-637c contract). stillTsMs keeps the co-occurrence stamp
                // (the honest shown+said moment); retries only choose which frame represents the
                // face, ~0.3-1s later, same person in frame. Single-face enforcement, the identity
                // euclidean, and every server gate are UNCHANGED.
                try {
                    const _EMB_TRIES = 4;              // 1 original + 3 fresh grabs
                    const _EMB_RETRY_GAP_MS = 300;
                    let _r = null;
                    for (let _t = 1; _t <= _EMB_TRIES; _t++) {
                        if (_t > 1) {
                            await new Promise(function(res){ setTimeout(res, _EMB_RETRY_GAP_MS); });
                            try {
                                c.getContext('2d').drawImage(v, 0, 0, cw, ch);   // fresh live frame
                                const _du = c.toDataURL('image/jpeg', 0.9);
                                const _cm = _du.indexOf(',');
                                if (_cm !== -1) stillB64 = _du.slice(_cm + 1);   // winning-frame still
                            } catch(_) { break; }                                 // video gone: keep last
                        }
                        const _EMB_TIMEOUT_MS = (_t === 1) ? 8000 : 2500;         // cold model on try 1
                        _r = await Promise.race([
                            window.VACFaceEmbed.compute(c),
                            new Promise(function(resolve){ setTimeout(function(){ resolve({ ok:false, reason:'embed_timeout' }); }, _EMB_TIMEOUT_MS); })
                        ]);
                        if (_r && _r.ok) {
                            faceEmbedding = _r.embedding;
                            console.log('[VAC] Fast reauth embedding computed (dim ' + _r.embedding.length + ', grab ' + _t + '/' + _EMB_TRIES + ')');
                            try { if (_t > 1) vacDebug('fast_reauth_embed_recovered', 'grab_' + _t); } catch(_) {}
                            break;
                        }
                        try { vacDebug('fast_reauth_embed_attempt', (_r && _r.reason) || 'no_result', { grab: _t, faceCount: (_r && _r.faceCount != null) ? _r.faceCount : null }); } catch(_) {}
                    }
                    if (!(_r && _r.ok)) {
                        try { vacDebug('fast_reauth_embedding_failed', (_r && _r.reason) || 'no_result', { faceCount: (_r && _r.faceCount != null) ? _r.faceCount : null, grabs: _EMB_TRIES }); } catch(_) {}
                    }
                } catch (ee) { try { vacDebug('fast_reauth_embedding_failed', 'compute_threw'); } catch(_) {} }
            } else {
                try { vacDebug('fast_reauth_embedding_failed', 'embedder_absent'); } catch(_) {}
            }
        }
    } catch (e) {
        // Never fabricate — an empty still tells the backend to fail-close (same contract as the clip still).
        console.warn('[VAC] Fast still capture failed (non-fatal):', (e && e.message) || e);
    }
    window.__vacFaceStillB64 = stillB64;
    // F-654: finalize the spoken-digit clip (if the policy required voice). Stop the recorder, wait
    // for the final chunk, base64-encode. Best-effort: a miss leaves spokenAudioB64 empty and the
    // server's bound-digit gate fails closed (never a fabricated pass).
    if (_captureVoice && _audioRec) {
        try {
            await new Promise(function(resolve){
                var _done = false; var _fin = function(){ if (_done) return; _done = true; resolve(); };
                _audioRec.onstop = _fin;
                try { _audioRec.stop(); } catch(_) { _fin(); }
                setTimeout(_fin, 1500); // backstop so a stuck recorder can't hang the flow
            });
            if (_audioChunks.length) {
                var _blob = new Blob(_audioChunks, { type: (_audioRec.mimeType || 'audio/webm') });
                var _b64 = await new Promise(function(resolve){
                    var fr = new FileReader();
                    fr.onloadend = function(){ var s = String(fr.result || ''); var ci = s.indexOf(','); resolve(ci !== -1 ? s.slice(ci + 1) : ''); };
                    fr.onerror = function(){ resolve(''); };
                    fr.readAsDataURL(_blob);
                });
                spokenAudioB64 = _b64 || '';
            }
        } catch(se) { console.warn('[VAC] quick-reauth audio finalize failed (non-fatal):', (se && se.message) || se); }
    }
    }   // end F-672 capture guard (!_fingerFailReason)
    // F-662: tear down the fast-tier voice analyser (started for the co-occurrence gate) BEFORE
    // releasing the mic — single cleanup chokepoint that every exit path (incl. the fail-closed
    // return below) passes through, so no VAD rAF / AudioContext is left alive (codex caveat A).
    // stopAudioMonitor is guarded: the fast hosts may lack the #audioLevel element it hides, but
    // its real teardown (cancel rAF, close context, null analyser) runs before that throwable line.
    try { if (_voiceGate) _voiceGate.stop(); } catch(_) {}
    // GATE-343 finding 5: the quick-auth VAD arms __vacGateArmed + #vacStepVU (line ~3435) but
    // never disarmed on gate end, leaving a stuck meter on the verdict/evidence screens below.
    // Same chokepoint as _voiceGate.stop() above → covers every exit path (success, fail-close,
    // fallback handoff). Mirrors _speechGateOff's teardown.
    try { window.__vacGateArmed = false; var _sv1 = document.getElementById('vacStepVU'); if (_sv1) _sv1.remove(); } catch(_) {}
    try { if (_audioRec && _audioRec.state && _audioRec.state !== 'inactive') _audioRec.stop(); } catch(_) {}   // F-672: on a fail-close path the audio finalize was skipped — stop the recorder here (no-op on the normal path, already inactive)
    try { stopAudioMonitor(); } catch(_) {}
    // Stop the camera — the still is captured, nothing more to record.
    try { if (mediaStream) mediaStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_) {}
    // F-671 Phase B1 (codex P2): hide the guided panels B1 now shows, mirroring the full path's
    // capture-end hide (#digitStrip / #vacGuided, lines ~1690-1691). Without this they stay
    // display:block after this attempt, so a "Start over" (toCamera → goToStep(1)) leaves the NEXT
    // fast attempt's lead-in/countdown showing the prior digit until beginStillCapture re-renders.
    // Scoped to the mount via byId (same resolver as the rest of the fast path).
    try { var _ds = byId('digitStrip'); if (_ds) _ds.style.display = 'none'; } catch(_) {}
    try { var _gp = byId('vacGuided'); if (_gp) _gp.style.display = 'none'; } catch(_) {}
    try { var _fh = byId('framingHint'); if (_fh) _fh.style.display = 'none'; } catch(_) {}   // codex P3: clear the out-of-zone banner too — checkHandFraming may have shown it this attempt
    goToStep(3);
    // F-672 FAIL-CLOSED: no valid finger count — detector down (no retry), or no hand after MAX 2 coached
    // retries. Route to the host fallback exactly like the embedding fail-close below; we NEVER reach
    // runFastVerification, so detected_fingers:null is never POSTed (the server 422 dead-end). A null
    // detectedFingers under a bound-digit challenge is also caught here (defensive floor).
    if (_fingerFailReason || detectedFingers == null) {
        var _ffr = _fingerFailReason || 'no_finger_captured';
        try { vacDebug('fast_reauth_failed', _ffr); } catch(_) {}
        // S145 finding 6: this is a CLIENT pre-gate stop — the request never reached the server,
        // so renderQuickReauthVerdict (server-denial path) never runs and the user was previously
        // dropped straight to onFallback's generic screen with no evidence. Render the same
        // self-reporting evidence line per attempt, THEN wait for the user to read it before
        // handing off — mirrors the server-denial Continue-button pattern above.
        var _rendered = false;
        try { _rendered = renderClientGateFailure(_ffr, _gateEvidence); } catch(_) { _rendered = false; }
        if (_rendered) {
            var _cgBtn = document.getElementById('qrContinueBtn');
            if (_cgBtn) {
                _cgBtn.onclick = function(){
                    if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth: ' + _ffr)); } catch(_) {} }
                };
                return;
            }
        }
        if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth: ' + _ffr)); } catch(_) {} }
        return;
    }
    // F-637c FAIL-CLOSED: the server's identity gate REQUIRES a live descriptor. With no clean
    // single-face embedding (0/>1 face, embedder down/absent/timeout, capture error) there is no
    // identity proof to send, so we NEVER POST a body the server could 200 on — it would fail at
    // embedding_invalid anyway. Route to the host fallback exactly as a denied/failed verify does
    // (same onFallback(error) contract as runFastVerification's error path).
    if (faceEmbedding == null) {
        try { vacDebug('fast_reauth_failed', 'embedding_missing_fail_closed'); } catch(_) {}
        if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth: no live face embedding')); } catch(_) {} }
        return;
    }
    await runFastVerification({ email: userData().email, challenge_id: challengeData && challengeData.challenge_id, detected_fingers: detectedFingers, face_still_b64: stillB64, face_embedding: faceEmbedding, spoken_audio_b64: spokenAudioB64, still_ts_ms: stillTsMs });
}

// F-624 Rung 2 (FAST verify): POST the small JSON envelope to /v1/auth/quick-reauth
// (endpoint + body shape from MODE_CONFIG[fast].verify) and hand the result back
// through the SAME authResult → _finish/onComplete contract the full clip uses, so
// the host sees an identical success path regardless of mode. Failures route to the
// host's onFallback, mirroring the clip path's error handoff.
async function runFastVerification(parts) {
    // F-637c (defense-in-depth, codex gate): re-verify the LIVE embedding shape at the terminal
    // POST path, not only in beginStillCapture. This is security-sensitive auth — a future/alternate
    // caller of runFastVerification must NOT be able to POST a body without a real 128-D identity
    // vector. Require a plain Array of EXPECTED_DIM finite numbers (a plain array also guarantees the
    // JSON serializes as [..], not the {"0":..} a typed array would). No valid embedding → fail
    // closed to the host fallback, never POST. The normal fast flow always passes (beginStillCapture
    // supplies a clean compute() result), so this only fires on an invalid/missing vector.
    const _EMB_DIM = (window.VACFaceEmbed && window.VACFaceEmbed.EXPECTED_DIM) || 128;
    const _emb = parts && parts.face_embedding;
    // Indexed loop, NOT Array.prototype.every: .every() SKIPS array holes, so a sparse array such
    // as new Array(128) would pass the finite-check vacuously and POST [null,null,...]. Reading
    // _emb[_i] yields undefined for a hole → typeof !== 'number' → rejected. Mirrors the per-index
    // validation VACFaceEmbed.compute itself uses, so a real dense descriptor still passes.
    let _embOk = Array.isArray(_emb) && _emb.length === _EMB_DIM;
    if (_embOk) {
        for (let _i = 0; _i < _EMB_DIM; _i++) {
            const _v = _emb[_i];
            if (typeof _v !== 'number' || !isFinite(_v)) { _embOk = false; break; }
        }
    }
    if (!_embOk) {
        try { vacDebug('fast_reauth_failed', 'embedding_invalid_preflight'); } catch(_) {}
        if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth: invalid live face embedding')); } catch(_) {} }
        return;
    }
    const vCfg = modeConfig().verify;
    // F-666 #4 (out-of-zone stranding guard): bound the backend wait so a stalled POST — e.g.
    // an out-of-zone capture produces a still the server never finishes answering — can never
    // leave the user on "Verifying…" forever. The timer arms HERE, AFTER the gesture loop +
    // still capture + 128-D embedding compute + goToStep(3) have all run, so it covers ONLY the
    // network round-trip, NEVER a slow-but-valid capture. On expiry the abort rejects fetch →
    // the EXISTING catch(e) below → CTX.onFallback (same handoff as any other failure, never a
    // strand). Cleared in finally the instant the POST settles — BEFORE the qrContinueBtn
    // user-read wait — so a slow reader can't trip it. GUARD ONLY: no change to the bound-digit
    // co-occurrence gate, the JSON body, or the authenticated/authorized verdict contract.
    const _qrCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const _QR_FETCH_TIMEOUT_MS = 30000;   // LIVE-TUNE; generous ceiling — a valid quick-reauth answers in a few seconds
    const _qrTimer = _qrCtrl ? setTimeout(function(){ try { _qrCtrl.abort(); } catch(_) {} }, _QR_FETCH_TIMEOUT_MS) : null;
    try {
        const _body = vCfg.buildBody(parts);   // fast → JSON object; full → FormData
        const _opts = { method: vCfg.method };
        if (_qrCtrl) _opts.signal = _qrCtrl.signal;   // F-666 #4: timeout/abort signal (guard only)
        if (_body instanceof FormData) { _opts.body = _body; }
        else if (_body != null) { _opts.headers = { 'Content-Type': 'application/json' }; _opts.body = JSON.stringify(_body); }
        const resp = await fetch(vCfg.url(), _opts);
        // ITEM 1: parse the verdict body on BOTH success and failure. A denied quick-reauth (401/409)
        // returns a JSON error verdict — FastAPI wraps HTTPException as { detail: {...} }, so unwrap it.
        // We no longer discard the failure body as text and throw (which dropped the user to a bare
        // result); we render it so the user sees WHICH modality failed and what to do.
        var _raw = null;
        try { _raw = await resp.json(); } catch(_) { _raw = null; }
        if (_raw && _raw.detail && typeof _raw.detail === 'object' && !Array.isArray(_raw.detail)) { authResult = _raw.detail; }
        else if (_raw != null) { authResult = _raw; }
        else if (!resp.ok) { authResult = { error: 'server_error', message: 'Server error ' + resp.status + '.', http_status: resp.status }; }
        else { authResult = {}; }
        // FAIL-CLOSED (codex P1): ONLY an explicit positive verdict on a 2xx may run the host SUCCESS
        // path (_finish → onComplete). A non-2xx, a negative verdict, or an unrecognised shape → host
        // fallback (deny). `resp.ok &&` makes a non-2xx un-passable even if the body claimed otherwise.
        const _ok = resp.ok && !!(authResult && (authResult.authenticated === true || authResult.authorized === true));
        try { vacDebug('fast_reauth_result', null, { ok: _ok, status: resp.status, keys: authResult ? Object.keys(authResult).join(',') : null }); } catch(_) {}
        // On success, surface the bound digit + advisory detected-finger count for the proof rows
        // (server need not echo them; the bound digit is THIS run's challenge, the count is what
        // beginStillCapture read). Only fill when absent, so a server-authoritative field wins.
        if (_ok && authResult && typeof authResult === 'object') {
            try {
                if (authResult.digit == null) authResult.digit = (challengeData && challengeData.digits && challengeData.digits.length) ? challengeData.digits[0] : null;
                if (authResult.detected_fingers == null) authResult.detected_fingers = (parts && parts.detected_fingers != null) ? parts.detected_fingers : null;
            } catch(_) {}
        }
        // ITEM 1: render the per-modality verdict modal on BOTH pass and fail. The button routes by
        // OUTCOME — pass → _finish (host success), fail → onFallback (host deny handoff). FAIL-CLOSED
        // preserved: a non-_ok result NEVER calls _finish, so a failed fast re-auth reveals nothing.
        try {
            renderQuickReauthVerdict(authResult);
            var _proceeded = false;
            var _cont = document.getElementById('qrContinueBtn');
            if (_cont) {
                _cont.onclick = function(){
                    if (_proceeded) return; _proceeded = true;
                    if (_ok) { _finish(); return; }
                    try { vacDebug('fast_reauth_denied', (authResult && authResult.error) || null); } catch(_) {}
                    // F-801: require_full_auth → route to full ceremony if the host registered onRequireFull;
                    // fall back to onFallback so hosts without the handler are never broken.
                    if (authResult && authResult.require_full_auth === true && CTX && CTX.onRequireFull) {
                        try { CTX.onRequireFull(CTX.context); } catch(_) {}
                        return;
                    }
                    if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth denied: ' + ((authResult && authResult.error) || 'denied'))); } catch(_) {} }
                };
                return;  // wait for the user to READ the verdict (pass OR fail) + tap the button
            }
        } catch(ve){ console.error('[VACReauth] quick verdict render', ve); }
        // No button (render failed / no host element) → preserve the direct handoff.
        if (_ok) { _finish(); return; }
        try { vacDebug('fast_reauth_denied'); } catch(_) {}
        if (CTX && CTX.onFallback) { try { CTX.onFallback(new Error('fast reauth denied')); } catch(_) {} }
    } catch (e) {
        console.error('[VACReauth] fast verify error', e);
        try { vacDebug('fast_reauth_failed', String((e && e.message) || e)); } catch(_) {}
        if (CTX && CTX.onFallback) { try { CTX.onFallback(e); } catch(_) {} }
    } finally {
        // F-666 #4: drop the watchdog the moment the POST settles — covers the early `return`
        // on the qrContinueBtn path too (finally runs on return), so the timer is gone before
        // the user reads the verdict and can never abort a resolved request.
        if (_qrTimer) clearTimeout(_qrTimer);
    }
}

// F-654: the quick-reauth modality verdict — same idea as the full-auth modality summary,
// so the user gets feedback (Rob: full auth shows results, quick-reauth showed nothing).
// Renders ONLY real fields from the /v1/auth/quick-reauth response (no fabrication):
//   identity   {metric:'euclidean', distance, threshold}  → FACE match (face-api.js 128-D)
//   bound_digit{shown_ok, spoken_ok, cooccur_ok}          → FINGER (MediaPipe) + spoken digit
//   liveness   {provider:'didit', status, score}          → passive liveness
// Each row is expandable (click → detail) with a down-chevron affordance so the user knows
// it's interactive. A section the server didn't send is shown as "not reported" — never faked.
function renderQuickReauthVerdict(res) {
    res = res || {};
    // F-671 cluster ITEM 1: FAILURE-aware verdict. On a DENIED quick-reauth the server returns
    // { error, message, retries_remaining, require_full_auth, _debug } (no per-modality objects — the
    // gate stops at the FIRST failing check). Render the SAME modal, mark the failing modality red,
    // and surface the plain reason + corrective action + retries — so the user is never dropped to a
    // bare result. PRESENTATION ONLY: the auth verdict + fail-closed handoff are decided upstream in
    // runFastVerification (a non-pass still routes to onFallback); this only explains the outcome.
    var _denied = (res.authenticated === false) || (res.authorized === false) || (typeof res.error === 'string' && !!res.error);
    var _errCode = (typeof res.error === 'string') ? res.error : null;
    var _reqFull = res.require_full_auth === true;
    var _retries = (typeof res.retries_remaining === 'number') ? res.retries_remaining : null;
    var _dbg = res._debug || {};
    var _expDigit = (challengeData && challengeData.digits && challengeData.digits.length) ? challengeData.digits[0] : null;
    // Map the server error code → which modality row failed + the corrective action the user can take.
    // Corrective action strings live in the registry (quick.denied.deny_act_*); digit params
    // interpolated at build-time so the copy matches the CURRENT challenge digit, not a hardcoded literal.
    var _R = VACCopy.resolve;
    var _FAIL = {
        face_mismatch:          { row:'face',     act: _R('quick','denied','deny_act_face_mismatch') },
        embedding_required:     { row:'face',     act: _R('quick','denied','deny_act_embedding_required') },
        no_embedding:           { row:'face',     act: _R('quick','denied','deny_act_no_embedding') },
        no_face_reference:      { row:'face',     act: _R('quick','denied','deny_act_no_face_reference') },
        corrupt_face_reference: { row:'face',     act: _R('quick','denied','deny_act_corrupt_face_reference') },
        finger_mismatch:        { row:'finger',   act: (_expDigit != null ? _R('quick','denied','deny_act_finger_mismatch',{digit:_expDigit}) : _R('quick','denied','deny_act_finger_mismatch_no_digit')) },
        spoken_digit_mismatch:  { row:'finger',   act: (_expDigit != null ? _R('quick','denied','deny_act_spoken_digit_mismatch',{digit:_expDigit}) : _R('quick','denied','deny_act_spoken_digit_mismatch_no_digit')) },
        not_cooccurring:        { row:'finger',   act: _R('quick','denied','deny_act_not_cooccurring') },
        liveness_failed:        { row:'liveness', act: _R('quick','denied','deny_act_liveness_failed') },
        liveness_unavailable:   { row:'liveness', act: _R('quick','denied','deny_act_liveness_unavailable') },
    };
    var _fail = _errCode ? _FAIL[_errCode] : null;
    var _failRow = _fail ? _fail.row : null;
    // Red reason banner (message + corrective action + retries) — built here, prepended to the modal below.
    var _reasonHtml = '';
    if (_denied) {
        var _msg = (typeof res.message === 'string' && res.message) ? res.message : _R('quick','denied','deny_default_msg');
        var _act = _fail ? _fail.act : (_reqFull ? 'Full verification is required.' : '');
        var _retTxt = _reqFull ? 'Full verification required'
            : (_retries != null && _retries > 0) ? (_retries + ' ' + (_retries === 1 ? 'try' : 'tries') + ' left')
            : (_retries === 0) ? 'No tries left — full verification required' : '';
        _reasonHtml = '<div style="border:1px solid var(--error);background:rgba(239,68,68,0.10);border-radius:10px;padding:11px 13px;margin-bottom:12px;">'
            + '<div style="color:var(--error);font-weight:700;font-size:14px;margin-bottom:3px;">' + _R('quick','denied','deny_heading') + '</div>'
            + '<div style="color:var(--text-primary);font-size:13px;line-height:1.4;">' + _msg + '</div>'
            + (_act ? ('<div style="color:var(--text-secondary);font-size:12px;margin-top:6px;">→ ' + _act + '</div>') : '')
            + (_retTxt ? ('<div style="color:var(--text-tertiary);font-family:var(--mono);font-size:11px;letter-spacing:0.5px;margin-top:6px;text-transform:uppercase;">' + _retTxt + '</div>') : '')
            + '</div>';
    }
    // F-666 #3: render where the user is LOOKING. beginStillCapture calls goToStep(3) before
    // verify, so step3 is active and #challengeText / #vacGuided (BOTH inside step2) are
    // display:none — the old hosts rendered the verdict + #qrContinueBtn into a HIDDEN step
    // ("dropdown doesn't expand on click"; Continue unreachable). Render into the VISIBLE step3
    // progress area (the spinner the user is watching), falling back to the legacy hosts only
    // if it is somehow absent.
    // F-671 Phase B1: document-global on purpose — kept consistent with the #qrContinueBtn wiring in
    // runFastVerification (HELD verify-path fn) and the _pc0 restore in beginStillCapture, so the whole
    // step3 verdict/continue cluster resolves the SAME elements. (Scoping it would need the held fn too.)
    var host = document.querySelector('#step3 .progress-container')
        || document.getElementById('challengeText') || document.getElementById('vacGuided');
    if (!host) return;
    // F-666 #3 (codex P2): snapshot the pristine progress markup ONCE, before this verdict
    // overwrites it, so beginStillCapture can rebuild step3 clean on a restart (else the stale
    // verdict + its #qrContinueBtn survive "Start over" and could complete the next run on the
    // prior result). Snapshot once per host element — the element is fresh each ceremony run.
    if (host.__qrOrigHTML == null) { try { host.__qrOrigHTML = host.innerHTML; } catch(_) {} }
    // The full-auth-only dropdowns in step3 are never populated in the fast tier — hide them so
    // the user doesn't see a redundant all-pending "Verification Modalities" / "Under the Hood"
    // list beside the real verdict. Cosmetic; no modality or verdict logic is touched.
    try { var _mr = document.getElementById('modalityResults'); if (_mr) _mr.style.display = 'none'; } catch(_) {}
    try { var _uh = document.getElementById('underHoodContainer'); if (_uh) _uh.style.display = 'none'; } catch(_) {}
    // Settle the step3 header from its in-flight "sending…" copy to a done state.
    try { var _vs = document.getElementById('verifySubtitle'); if (_vs) _vs.textContent = _denied ? 'Quick re-auth was not confirmed — here is what the backend checked.' : 'Quick re-auth complete — here is what the backend checked.'; } catch(_) {}
    function row(id, name, detector, ok, detail) {
        var statusTxt = (ok === true) ? 'verified' : (ok === false ? 'failed' : 'not reported');
        var color = (ok === true) ? 'var(--success)' : (ok === false ? 'var(--error)' : 'var(--text-tertiary)');
        var mark = (ok === true) ? '\u2713' : (ok === false ? '\u2717' : '\u2013');
        return '<div class="qr-mod-row" data-qr="' + id + '" style="cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:8px;background:var(--surface);">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'
            +   '<div style="display:flex;align-items:center;gap:9px;"><span style="color:' + color + ';font-weight:800;font-size:15px;">' + mark + '</span><span style="font-weight:600;color:var(--text-primary);font-size:14px;">' + name + '</span></div>'
            +   '<div style="display:flex;align-items:center;gap:8px;"><span style="font-family:var(--mono);font-size:11px;letter-spacing:0.5px;color:' + color + ';text-transform:uppercase;">' + statusTxt + '</span>'
            +     '<span id="qrc-' + id + '" style="display:inline-block;transition:transform 0.15s;color:var(--text-tertiary);font-size:11px;">\u25BC</span></div>'
            + '</div>'
            + '<div id="qrd-' + id + '" style="display:none;margin-top:9px;padding-top:9px;border-top:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.5;">'
            +   '<div style="color:var(--text-tertiary);font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Detector</div>' + detector
            +   (detail ? ('<div style="margin-top:7px;color:var(--text-tertiary);font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Result</div>' + detail) : '')
            + '</div>'
            + '</div>';
    }
    // FACE identity — success uses the reported distance/threshold; a face-family denial marks it red
    // (ITEM 2 fold: face is a REQUIRED reauth modality, shown as a first-class gating row, never can_skip).
    var idy = res.identity || null;
    var faceOk = idy ? (typeof idy.distance === 'number' && typeof idy.threshold === 'number' ? idy.distance <= idy.threshold : null) : (_failRow === 'face' ? false : null);
    var faceDetail = idy ? ('Euclidean distance <strong>' + idy.distance + '</strong> vs threshold <strong>' + idy.threshold + '</strong> (lower = closer match).')
        : (_failRow === 'face' ? ((typeof _dbg.distance === 'number' ? ('Euclidean distance <strong>' + _dbg.distance + '</strong> vs threshold <strong>' + (_dbg.threshold != null ? _dbg.threshold : '0.5') + '</strong> — too far to confirm. ') : '') + _fail.act)
        : (_denied ? 'Not reached — an earlier check stopped the verification.' : 'Server did not report a face-match distance.'));
    // BOUND DIGIT (finger + spoken)
    var bd = res.bound_digit || null;
    var fingerOk = bd ? (bd.shown_ok === true) : (_failRow === 'finger' ? false : null);
    var fingerDetail = bd
        ? ('Shown fingers ' + (bd.shown_ok ? 'matched' : 'did NOT match') + ' the challenge; spoken digit ' + (bd.spoken_ok ? 'matched' : 'not matched') + '; co-occurrence ' + (bd.cooccur_ok ? 'confirmed' : 'not confirmed') + '.')
        : (_failRow === 'finger' ? _fail.act : (_denied ? 'Not reached — an earlier check stopped the verification.' : 'Server did not report a bound-digit result (this re-auth may have run an advisory finger check).'));
    // LIVENESS
    var lv = res.liveness || null;
    var liveOk = lv ? (lv.status === 'verified') : (_failRow === 'liveness' ? false : null);
    // F-790-QA: on a liveness fail-close, the server's _debug carries didit_status
    // ('error' = provider/API problem vs 'failed' = genuine liveness decline) + didit_error.
    // Rendering it distinguishes "the provider erred" from "your face failed" — today's
    // pattern (Didit err on every run since morning, after clean passes yesterday) points
    // at provider/quota trouble; this line settles it per-attempt.
    var _lvDbg = (_failRow === 'liveness' && (_dbg.didit_status || _dbg.didit_error))
        ? (' <span style="color:var(--text-tertiary);font-size:12px;">[provider status: ' + (_dbg.didit_status || '?') + (_dbg.didit_error ? (' · ' + _dbg.didit_error) : '') + ']</span>')
        : '';
    var liveDetail = lv ? ('Provider <strong>' + (lv.provider || 'didit') + '</strong>, status <strong>' + (lv.status || '?') + '</strong>' + (lv.score != null ? (', score <strong>' + lv.score + '</strong>') : '') + '.')
        : (_failRow === 'liveness' ? (_fail.act + _lvDbg) : (_denied ? 'Not reached — an earlier check stopped the verification.' : 'Server did not report a liveness result.'));

    var _req = reauthPolicyRequired() || [];
    var _label = '<div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:10px;">Verification modalities \u2014 tap a row for detail</div>';
    var _btnLabel = !_denied ? 'Continue \u2192'
        : (_reqFull ? _R('quick','results','btn_continue_full')
        : ((_retries == null || _retries > 0) ? _R('quick','results','btn_try_again') : 'Continue \u2192'));
    host.innerHTML = '<div style="text-align:left;max-width:460px;margin:0 auto;">' + _reasonHtml + _label
        + row('face', 'Face match', 'face-api.js 128-D embedding, euclidean distance vs your stored template (server-computed).', faceOk, faceDetail)
        + row('finger', 'Number on fingers', 'MediaPipe HandLandmarker (client) \u2014 the bound digit, shown AND said.', fingerOk, fingerDetail)
        + row('liveness', 'Passive liveness', 'Didit passive-liveness on the captured still (server, fail-closed).', liveOk, liveDetail)
        + '<button id="qrContinueBtn" style="width:100%;margin-top:14px;padding:14px;border:none;border-radius:12px;background:var(--purple,#7c5cfc);color:#fff;font-weight:700;font-size:15px;cursor:pointer;">' + _btnLabel + '</button>'
        + '</div>';
    // F-666 #3: wire ONE delegated expander listener on the (stable) host rather than a per-row
    // inline handler \u2014 robust to the innerHTML re-render above, and the literal "wire the expander
    // listener" fix. A tap on any .qr-mod-row toggles its #qrd-<id> detail + rotates the #qrc-<id>
    // caret. Bound once per host element (host is a fresh node each ceremony run, so no stacking).
    if (!host.__qrExpanderBound) {
        host.__qrExpanderBound = true;
        host.addEventListener('click', function(e){
            var rowEl = (e.target && e.target.closest) ? e.target.closest('.qr-mod-row') : null;
            if (!rowEl) return;
            var qid = rowEl.getAttribute('data-qr');
            var d = document.getElementById('qrd-' + qid);
            if (!d) return;
            var isOpen = d.style.display !== 'none';
            d.style.display = isOpen ? 'none' : 'block';
            var c = document.getElementById('qrc-' + qid);
            if (c) c.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
        });
    }
}

// S145 finding 6: the quick-auth CLIENT pre-gate (beginStillCapture's finger-detection retries)
// can fail-closed before any POST reaches the server, so renderQuickReauthVerdict above (which
// only renders SERVER-reported verdicts) never runs. Previously that silently dropped the user
// straight to CTX.onFallback's generic screen — no evidence, no way to self-correct (Rob: a
// 3-failure mystery in the field needed a manual ?qa=1 ask to explain). This renders the SAME
// evidence-card visual style as the modality rows above, one compact line per client attempt:
// {stage, detected_finger_count, expected_count, zone_in, attempt_n}. Client-side only — the
// challenge digit is already shown in-session, so no new security surface. Returns true if it
// rendered into a live host (caller falls back to the direct onFallback handoff otherwise).
function renderClientGateFailure(reason, evidence) {
    var host = document.querySelector('#step3 .progress-container')
        || document.getElementById('challengeText') || document.getElementById('vacGuided');
    if (!host) return false;
    if (host.__qrOrigHTML == null) { try { host.__qrOrigHTML = host.innerHTML; } catch(_) {} }
    try { var _mr = document.getElementById('modalityResults'); if (_mr) _mr.style.display = 'none'; } catch(_) {}
    try { var _uh = document.getElementById('underHoodContainer'); if (_uh) _uh.style.display = 'none'; } catch(_) {}
    try { var _vs = document.getElementById('verifySubtitle'); if (_vs) _vs.textContent = 'Quick re-auth was not confirmed — here is what this device checked.'; } catch(_) {}
    var _reasonMsg = (reason === 'finger_detector_down') ? 'The hand detector could not start on this device.'
        : (reason === 'no_finger_after_retry') ? "We couldn't get a steady reading of your fingers."
        : (reason === 'finger_lost_at_capture') ? 'Your hand moved out of frame right at capture.'
        : "We couldn't confirm your fingers.";
    var _reasonHtml = '<div style="border:1px solid var(--error);background:rgba(239,68,68,0.10);border-radius:10px;padding:11px 13px;margin-bottom:12px;">'
        + '<div style="color:var(--error);font-weight:700;font-size:14px;margin-bottom:3px;">Not confirmed — full verification required</div>'
        + '<div style="color:var(--text-primary);font-size:13px;line-height:1.4;">' + _reasonMsg + '</div>'
        + '</div>';
    var _label = '<div style="font-family:var(--mono);font-size:10px;letter-spacing:1.5px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:10px;">Client check evidence — what this device saw, per attempt</div>';
    var _rows = '';
    (evidence || []).forEach(function(ev){
        var _saw = (ev.detected_finger_count == null) ? 'nothing (detector down)' : (ev.detected_finger_count < 0 ? '0' : String(ev.detected_finger_count));
        var _needed = (ev.expected_count != null) ? String(ev.expected_count) : '?';
        var _zoneTxt = ev.zone_in ? 'zone IN' : 'zone OUT';
        _rows += '<div class="qr-mod-row" style="border:1px solid var(--border);border-radius:10px;padding:9px 13px;margin-bottom:6px;background:var(--surface);">'
            + '<span style="color:var(--text-tertiary);font-family:var(--mono);font-size:10px;letter-spacing:0.5px;text-transform:uppercase;margin-right:8px;">Attempt ' + ev.attempt_n + '</span>'
            + '<span style="font-size:13px;color:var(--text-primary);">Fingers: saw ' + _saw + ', needed ' + _needed + ' — ' + _zoneTxt + '</span>'
            + '</div>';
    });
    if (!_rows) { _rows = '<div style="color:var(--text-tertiary);font-size:12px;margin-bottom:8px;">No per-attempt evidence was captured for this run.</div>'; }
    host.innerHTML = '<div style="text-align:left;max-width:460px;margin:0 auto;">' + _reasonHtml + _label + _rows
        + '<button id="qrContinueBtn" style="width:100%;margin-top:14px;padding:14px;border:none;border-radius:12px;background:var(--purple,#7c5cfc);color:#fff;font-weight:700;font-size:15px;cursor:pointer;">Continue →</button>'
        + '</div>';
    return true;
}

async function onRecordingComplete() {
    // F-720: client-side clip floor — belt-and-suspenders behind the onstop guard.
    // A near-zero clip means the recorder or stream died; never POST garbage to the backend.
    var _clipElapsed = performance.now() - _recorderStartMs;
    var _clipBytes = recordedChunks.reduce(function(a, c){ return a + c.size; }, 0);
    if (_clipBytes < 20480 || _clipElapsed < 2000) {
        try { vacDebug('clip_floor_abort', null, { bytes: _clipBytes, elapsed_ms: Math.round(_clipElapsed) }); } catch(_) {}
        _showCaptureDiedRecovery();
        return;
    }
    document.getElementById('recIndicator').style.display = 'none';
    document.getElementById('cameraBoxRec').classList.remove('recording', 'show-hand-zone', 'hand-in-zone', 'hand-visible');
    stopAudioMonitor();

    // Capture the face IDENTITY embedding from the LIVE recording frame BEFORE the camera
    // stops (face-api.js 128-D descriptor, single-face enforced). Stored on a passing
    // verify as the re-auth template. Best-effort: a miss enrolls the user in legacy/
    // description mode — the server-side multi-modal verify still guards the enrollment.
    window.__vacEnrollEmbedding = null;
    try {
        const ev = document.getElementById('videoPreviewRec');
        if (ev && ev.videoWidth && window.VACFaceEmbed) {
            const ec = document.createElement('canvas');
            ec.width = ev.videoWidth; ec.height = ev.videoHeight;
            ec.getContext('2d').drawImage(ev, 0, 0);
            const r = await window.VACFaceEmbed.compute(ec);
            if (r.ok) { window.__vacEnrollEmbedding = r.embedding; console.log('[VAC] Enroll embedding computed (dim ' + r.embedding.length + ')'); }
            else { console.warn('[VAC] Enroll embedding skipped:', r.reason, '— legacy/description enrollment'); }
        }
    } catch (e) { console.warn('[VAC] Enroll embedding error (non-fatal):', (e && e.message) || e); }

    // Stop camera
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
    }

    goToStep(3);

    // Build the blob
    const videoBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    
    await runRealVerification(videoBlob);
}

// STEP 3: Upload to backend, show real results
async function runRealVerification(videoBlob) {
    const ring = document.getElementById('progressRing');
    const stepEl = document.getElementById('progressStep');
    const detailEl = document.getElementById('progressDetail');
    const circumference = 2 * Math.PI * 36;

    // INTEGRITY (re-auth stale-7/7): clear the PRIOR run's modality tiles BEFORE this run's
    // spinner/fetch, so the panel can never show a pass while THIS verification is still
    // computing. Every verify path funnels through here, so this covers initial + re-auth.
    try { resetModalities(); } catch(_) {}

    // Progress animation while we wait for backend
    stepEl.textContent = 'Uploading recording…';
    detailEl.textContent = `${(videoBlob.size / 1024).toFixed(0)} KB → verification engines`;
    ring.style.strokeDashoffset = circumference * 0.85;

    // Set geolocation as verified immediately (it's browser-side)
    // Geolocation removed from initial auth — reserved for groups/governance

    // F-789: save blob so retryVerification can re-upload without re-recording
    window.__vacLastVerifyBlob = videoBlob;
    window.__vacLastVerifyFailWasTransport = false;

    try {
        // Build multipart form data
        const formData = new FormData();
        formData.append('video', videoBlob, 'capture.webm');
        formData.append('challenge_id', challengeData?.challenge_id || 'none');
        formData.append('name', userData().name);
        formData.append('email', userData().email);
        formData.append('org_name', userData().org);
        formData.append('org_role', userData().role);
        // W3.5: send client-detected finger sequence (MediaPipe HandLandmarker).
        // Server cross-validates against Gemini's analysis. Empty if MediaPipe
        // failed or voice-only fallback; server falls back to Gemini-only then.
        const clientSeq = (window.__vacDetectedCounts || []).filter(function(n) { return n > 0; });
        formData.append('client_detected_counts', JSON.stringify(clientSeq));
        // F-GESTURE-ZONE-QUALIFIES-POSE: deterministic per-pose in-zone signal, index-aligned 1:1
        // with the poses above (built by append at each accepted pose, so it covers every real
        // detected pose — including an out-of-zone retry the backend must drop — without the n>0
        // filter). Each entry: true=in-zone, false=out-of-zone, null=undeterminable (keep). The
        // backend (vac-protocol lane) consumes this to drop out-of-zone retry poses deterministically
        // instead of leaving it to Gemini's discretion. Empty when detection didn't run (manual
        // fallback / voice-only) — same as client_detected_counts.
        formData.append('client_pose_zones', JSON.stringify(window.__vacPoseZones || []));
        // Face IDENTITY embedding (face-api.js 128-D). Stored on pass as the re-auth
        // template. Omitted when single-face/embedder failed → legacy description enrollment.
        if (window.__vacEnrollEmbedding) {
            formData.append('face_embedding', JSON.stringify(window.__vacEnrollEmbedding));
        }
        // S-116 Track-2: bound-moment still for Didit passive liveness. Captured from
        // the LIVE buffer during the speak phase (see beginRecording) and appended to
        // THIS SAME request — no extra round-trip. Empty when frame capture failed →
        // backend fail-closes Didit; Gemini path is unaffected. ts is the ms offset of
        // the frame within the recording. Mirrors the face_embedding precedent:
        // client-computed, backend tolerates-or-drops.
        formData.append('face_still_b64', window.__vacFaceStillB64 || '');
        formData.append('face_still_ts_ms', String(Number.isFinite(window.__vacFaceStillTsMs) ? window.__vacFaceStillTsMs : 0));

        stepEl.textContent = 'Analysing biometrics…';
        detailEl.textContent = 'Gemini (face) + Deepgram (voice)';
        ring.style.strokeDashoffset = circumference * 0.6;

        // Smooth progress animation while waiting
        var progress = 0.75;
        ring.style.strokeDashoffset = circumference * progress;
        var pSteps = [
            {at: 0.65, text: 'Uploading recording...'},
            {at: 0.55, text: 'Face liveness check...'},
            {at: 0.45, text: 'Deepfake analysis...'},
            {at: 0.35, text: 'Voice transcription...'},
            {at: 0.25, text: 'Lip sync correlation...'},
            {at: 0.18, text: 'Finger gesture analysis...'},
            {at: 0.12, text: 'Computing trust score...'},
        ];
        var pIdx = 0;
        var progressTimer = setInterval(function() {
            progress -= 0.015;
            if (progress < 0.08) progress = 0.08;
            ring.style.strokeDashoffset = circumference * progress;
            if (pIdx < pSteps.length && progress <= pSteps[pIdx].at) {
                detailEl.textContent = pSteps[pIdx].text;
                pIdx++;
            }
        }, 250);

        // Send to backend — F-624 Rung 2: endpoint/method/body come from the active MODE's
        // verify config (declarative, single source). This clip path is always FULL, so
        // buildBody hands the FormData straight back → POST multipart to /v1/vat/auth/verify,
        // byte-identical to before. (FAST verify goes through runFastVerification instead.)
        const _vCfg = modeConfig().verify;
        const _vBody = _vCfg.buildBody({ formData: formData });
        const _vBaseOpts = { method: _vCfg.method };
        if (_vBody instanceof FormData) { _vBaseOpts.body = _vBody; }
        else if (_vBody != null) { _vBaseOpts.headers = { 'Content-Type': 'application/json' }; _vBaseOpts.body = JSON.stringify(_vBody); }

        // F-789: transport retry — up to 3 attempts, 3s/6s backoff before attempts 2/3,
        // 90s stall-guard each. Retry ONLY on network-level failures (TypeError/AbortError/
        // 502/503/504). 4xx and well-formed verify responses are results, not transport errors.
        var _UPLOAD_RETRIES = 3;
        var _UPLOAD_BACKOFF_MS = [0, 0, 3000, 6000];
        var resp = null;
        for (var _uAttempt = 1; _uAttempt <= _UPLOAD_RETRIES; _uAttempt++) {
            if (_uAttempt > 1) {
                clearInterval(progressTimer); // pause cosmetic animation during backoff wait
                stepEl.textContent = 'Connection dropped — retrying upload (' + _uAttempt + '/' + _UPLOAD_RETRIES + ')…';
                detailEl.textContent = 'Waiting before retry…';
                await sleep(_UPLOAD_BACKOFF_MS[_uAttempt]);
            }
            var _uAc = new AbortController();
            var _uStall = setTimeout(function() { _uAc.abort(); }, 90000);
            try {
                resp = await fetch(_vCfg.url(), Object.assign({}, _vBaseOpts, { signal: _uAc.signal }));
                clearTimeout(_uStall);
                if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
                    try { vacDebug('verify_upload_attempt', null, { n: _uAttempt, err: 'HTTP ' + resp.status }); } catch(_) {}
                    if (_uAttempt < _UPLOAD_RETRIES) { resp = null; continue; }
                    window.__vacLastVerifyFailWasTransport = true;
                    throw new Error('Upload failed after ' + _UPLOAD_RETRIES + ' attempts (HTTP ' + resp.status + '). Check your connection and try again.');
                }
                if (_uAttempt > 1) {
                    try { vacDebug('verify_upload_recovered', null, { n: _uAttempt }); } catch(_) {}
                }
                break;
            } catch (_uErr) {
                clearTimeout(_uStall);
                var _uIsTransport = (_uErr instanceof TypeError || _uErr.name === 'AbortError');
                if (_uIsTransport) {
                    try { vacDebug('verify_upload_attempt', null, { n: _uAttempt, err: _uErr.message || String(_uErr) }); } catch(_) {}
                    if (_uAttempt < _UPLOAD_RETRIES) { resp = null; continue; }
                    window.__vacLastVerifyFailWasTransport = true;
                    // Throw structured message so the outer catch shows the connection-specific tip
                    throw new Error('Upload failed after ' + _UPLOAD_RETRIES + ' attempts (' + (_uErr.name === 'AbortError' ? '90s stall' : 'network error') + '). Check your connection and try again.');
                }
                throw _uErr;
            }
        }

        if (!resp.ok) {
            var errText = await resp.text();
            var errDetail = '';
            try {
                var errJson = JSON.parse(errText);
                errDetail = errJson.detail || errJson.message || errText;
            } catch(x) { errDetail = errText; }
            throw new Error('Server error ' + resp.status + ': ' + errDetail.substring(0, 300));
        }

        authResult = await resp.json();
        authResult._challenge_id = challengeData?.challenge_id || ''; // for copilot mode biometric upgrade
        window.__vacLastVerifyBlob = null; // F-789: clear saved blob — upload succeeded
        clearInterval(progressTimer);

        // Update modality displays with real results
        ring.style.strokeDashoffset = circumference * 0.2;
        stepEl.textContent = 'Processing results…';

        const mods = authResult.biometric_verification?.modalities || [];
        // Auto-open modality dropdown when results arrive
        const toggleEl = document.getElementById('modalityToggle');
        const listEl = document.getElementById('modalityList');
        // Dropdown stays collapsed — user clicks to expand
        for (const mod of mods) {
            const elId = {
                'face_liveness': 'modFace',
                'face_liveness_didit': 'modDidit',
                'deepfake_detection': 'modDeepfake',
                'voiceprint': 'modVoice',
                'lip_sync': 'modLipSync',
                'challenge_response': 'modChallenge',
                'finger_gesture': 'modFinger',
                'duress': 'modDuress',
                'geolocation': null, // not used in initial auth
            }[mod.name];
            if (elId) {
                // Map duress status: clear→verified, alert→failed
                var displayStatus = mod.status;
                if (mod.name === 'duress') { displayStatus = mod.status === 'clear' ? 'verified' : 'failed'; }
                updateModality(elId, displayStatus, mod.score, mod.name, mod.detail);
                await sleep(150); // Stagger for visual effect
            }
        }

        // Final state
        ring.style.strokeDashoffset = 0;
        // RENDER-ONLY (S155): strict === true, not truthiness — the client renders the server's
        // exact boolean contract field, never a loosened interpretation of it.
        const passed = authResult.authenticated === true;
        // F-560: surface final pass/fail + which modality failed on the QA overlay.
        // authResult.authenticated stays the source of truth (RESULT line); failed[] is a hint.
        try {
            const _qaFailed = (mods || []).filter(function (m) {
                if (m.name === 'duress') return m.status && m.status !== 'clear';
                return m.status && m.status !== 'passed' && m.status !== 'verified';
            }).map(function (m) { return m.name; });
            vacDebug('qa_final_result', null, { pass: !!passed, failed: _qaFailed });
        } catch(_) {}
        // Populate Under the Hood with engine data
        try{populateUnderHood(authResult);}catch(uhErr){console.error("Under hood error:",uhErr);}

        if (passed) {
            stepEl.textContent = 'Human verified ✓';
            ring.style.stroke = 'var(--success)';
            detailEl.textContent = `Trust score: ${authResult.biometric_verification.overall_score}`;
            await sleep(400);
            _finish();
        } else {
            stepEl.textContent = 'Verification incomplete';
            ring.style.stroke = 'var(--warning)';
            detailEl.textContent = `Trust score: ${authResult.biometric_verification.overall_score}`;
            showRetry(authResult);
        }

    } catch (e) {
        clearInterval(progressTimer);
        var msg = e.message || 'Network error';
        var tip = '';
        if (msg.indexOf('expired challenge') >= 0 || msg.indexOf('Invalid or expired') >= 0 || msg.indexOf('Challenge not found') >= 0) {
            msg = 'Your challenge expired or the server restarted. Not your fault.';
            tip = 'Tap Retry for a fresh challenge. This usually resolves on retry.';
        } else if (msg.indexOf('400') >= 0) {
        } else if (msg.indexOf("Liveness") >= 0 || msg.indexOf("live person") >= 0) {
            msg = "Face liveness check did not pass. Make sure your face is clearly visible.";
            tip = "Look directly at the camera in good lighting. Avoid shadows.";
        } else if (msg.indexOf("authenticity") >= 0) {
            msg = "Video authenticity check did not pass.";
            tip = "Try again in better lighting with a clearer camera angle.";
        } else if (msg.indexOf("Challenge verification") >= 0) {
            msg = "Could not match what you said to the challenge phrase.";
            tip = "Speak each word and number slowly and clearly. Tap Retry.";
        } else if (msg.indexOf("400") >= 0) {
            msg = "The server could not process your recording.";
            tip = "Speak clearly, keep face and fingers visible. Tap Retry.";
        } else if (msg.indexOf("500")>=0) {
            msg="Servers temporarily busy.";tip="Wait and tap Retry.";
        } else if (msg.indexOf('Upload failed after') >= 0) {
            msg = 'Connection dropped during upload.';
            tip = 'Your recording is saved. Tap Retry to upload it again.';
            // F-792 item 2 (Rob field-catch): transport failure = saved blob re-upload, NOT a redo —
            // button copy must match the tip. Registry key with hard fallback; other states keep
            // the default "Retry Verification" set in the template.
            try {
                var _rb = document.querySelector('#retryTips')
                    ? document.querySelector('button[onclick="retryVerification()"]') : null;
                if (_rb) _rb.textContent = (window.VACCopy && VACCopy.resolve)
                    ? VACCopy.resolve('quick','results','btn_retry_upload')
                    : 'Retry upload \u2192';
            } catch (_) {}
        } else {
            msg = "Something went wrong during verification.";
            tip = "Tap Retry to try again. Speak clearly and keep your face and fingers visible.";
        }
        stepEl.textContent = 'Verification error';
        detailEl.textContent = msg;
        ring.style.stroke = 'var(--error)';
        console.error('Verification failed:', e);
        var retryEl = document.getElementById('retrySection');
        retryEl.style.display = 'block';
        document.getElementById("failReasons").parentElement.style.display="none";
        document.getElementById('retryTipsList').textContent = tip;
        try{document.getElementById("modalityToggle").style.display="none";document.getElementById("underHoodContainer").style.display="none";}catch(x){}
        retryAttempts++;
        document.getElementById('retryCount').textContent = retryAttempts > 1 ? 'Attempt ' + retryAttempts + ' of ' + MAX_RETRIES : '';
        if (retryAttempts >= MAX_RETRIES) {
            document.getElementById('btnContinueAnyway').style.display = 'inline-flex';
        }
    }
}



// ========== modality result UI ==========

function updateModality(elId, status, score, modName, detail) {
    const el = document.getElementById(elId);
    if (!el) return;
    const statusEl = el.querySelector('.mod-status');
    const scoreEl = el.querySelector('.mod-score');
    // Add detail expand if we have engine data
    if (detail && modName) {
        var existing = el.querySelector('.mod-detail-expand');
        if (!existing) {
            var detDiv = document.createElement('div');
            detDiv.className = 'mod-detail-expand';
            // F-AUTH-UX-POLISH (1): NO inline display + NO separate row onclick here. Visibility is
            // CSS-driven off the row's `.open` class (set by toggleModRow on the row's onclick), so the
            // engine detail expands/collapses in lockstep with the caret + the static .mod-desc.
            detDiv.style.cssText = 'width:100%;font-size:11px;color:var(--text-quaternary);padding:4px 0 6px 24px;line-height:1.5;font-family:var(--mono)';
            el.appendChild(detDiv);
        }
        var dd = el.querySelector('.mod-detail-expand');
        if (dd) {
            var lines = [];
            if (modName==='face_liveness'){if(detail.person_description)lines.push('Saw: '+detail.person_description);if(detail.face_detected)lines.push('Face: yes');if(detail.blink_detected)lines.push('Blink: yes');}
            if (modName==='face_liveness_didit'){lines.push('Provider verdict: '+(detail.didit_status||'—'));lines.push('Liveness score: '+(detail.score_raw!=null?detail.score_raw+'/100':'—'));if(detail.warnings&&detail.warnings.length)lines.push('Flags: '+detail.warnings.join(', '));else lines.push('Flags: none');if(detail.face_quality!=null)lines.push('Face quality: '+detail.face_quality+'/100');}
            if (modName==='deepfake_detection'){lines.push('Deepfake likelihood: '+(detail.deepfake_likelihood!==undefined?(detail.deepfake_likelihood*100).toFixed(0)+'%':'--'));if(!detail.artifacts||!detail.artifacts.length)lines.push('Artifacts: none');}
            if (modName==='voiceprint'&&detail.confidence){lines.push('Speech clarity: '+(detail.confidence*100).toFixed(0)+'%');}
            if (modName==='lip_sync'){lines.push('Lip-audio match: '+(detail.matches_audio?'yes':'no'));}
            if (modName==='challenge_response'){if(detail.heard)lines.push('Heard: '+detail.heard);if(detail.expected)lines.push('Expected: '+detail.expected);if(detail.match_ratio!==undefined)lines.push('Match: '+(detail.match_ratio*100).toFixed(0)+'%');}
            if (modName==='finger_gesture'){if(detail.digits_expected)lines.push('Expected: ['+detail.digits_expected.join(', ')+']');if(detail.digits_seen)lines.push('Gemini saw: ['+detail.digits_seen.join(', ')+']');if(detail.hand_near_face!==undefined)lines.push('Hand near face: '+(detail.hand_near_face?'yes':'no'));
              // F-771: descriptive context shown to ALL users (transparency, like Face Liveness) — safe, no detector internals.
              if(detail.gemini_person_description)lines.push('Saw: '+detail.gemini_person_description);
              // F-769: raw detector telemetry stays QA-only (exposes forgeable client counts / source path).
              try { if (typeof QA !== 'undefined' && QA && QA.on) {
                if(detail.gemini_fingers_detected!==undefined && detail.gemini_fingers_detected!==null)lines.push('[qa] Gemini fingers_detected: '+detail.gemini_fingers_detected);
                if(detail.gemini_confidence!==undefined && detail.gemini_confidence!==null)lines.push('[qa] Gemini confidence: '+detail.gemini_confidence);
                if(detail.client_detected_counts)lines.push('[qa] Client counts sent: ['+(detail.client_detected_counts||[]).join(', ')+']');
                if(detail.sequence_source)lines.push('[qa] Sequence source: '+detail.sequence_source);
                if(detail.f776_recall_status)lines.push('[qa] F-776 recall: '+detail.f776_recall_status);
                if(detail.digits_seen_raw)lines.push('[qa] Gemini RAW (pre-zone-filter): ['+(detail.digits_seen_raw||[]).join(', ')+']');
                if(detail.pose_zones_applied!==undefined)lines.push('[qa] Zone filter applied: '+detail.pose_zones_applied+' | zones: '+JSON.stringify(detail.pose_zones||null)+' | dropped: '+(detail.poses_dropped_out_of_zone!==undefined?detail.poses_dropped_out_of_zone:'?'));
                if(detail.gemini_video_bytes!==undefined && detail.gemini_video_bytes!==null)lines.push('[qa] Video sent to Gemini: '+(detail.gemini_video_bytes/1048576).toFixed(2)+' MB ('+detail.gemini_video_bytes+' bytes, '+(detail.gemini_video_branch||'?')+')');
              } } catch(_){}
            }
            if (modName==='duress'){lines.push('Duress likelihood: '+(detail.duress_likelihood!==undefined?(detail.duress_likelihood*100).toFixed(0)+'%':'0%'));if(detail.indicators&&detail.indicators.length)lines.push('Indicators: '+detail.indicators.join(', '));else lines.push('No distress indicators detected');lines.push('Status: '+(detail.under_duress?'⚠️ ALERT — silent alarm triggered':'✅ Clear — no signs of coercion'));}
            dd.innerHTML = lines.join('<br>');
        }
    }

    // UI HONESTY (S117): ADVISORY rows (Finger Gesture, Duress) are never consulted in the verdict,
    // so they must NOT render a green/red pass/fail dot that mimics the mandatory modalities. Show a
    // neutral muted dot + muted score — the number stays visible (informational), the gate framing
    // does not. The real per-row status (pass/fail, clear/alert) still lives in the expand detail.
    if (el.classList.contains('advisory')) {
        statusEl.textContent = '•';
        statusEl.style.color = 'var(--text-tertiary)';
        scoreEl.textContent = typeof score === 'number' ? score.toFixed(2) : '—';
        scoreEl.className = 'mod-score advisory';
        updateModalitySummary();
        return;
    }

    if (status === 'verified') {
        statusEl.textContent = '✓';
        statusEl.style.color = 'var(--success)';
        scoreEl.textContent = typeof score === 'number' ? score.toFixed(2) : '—';
        scoreEl.className = 'mod-score pass';
    } else if (status === 'failed') {
        statusEl.textContent = '✗';
        statusEl.style.color = 'var(--error)';
        scoreEl.textContent = typeof score === 'number' ? score.toFixed(2) : '—';
        scoreEl.className = 'mod-score fail';
    } else if (status === 'error') {
        statusEl.textContent = '⚠';
        statusEl.style.color = 'var(--warning)';
        scoreEl.textContent = 'err';
        scoreEl.className = 'mod-score fail';
    } else if (status === 'inconclusive') {
        statusEl.textContent = '~';
        statusEl.style.color = 'var(--warning)';
        scoreEl.textContent = typeof score === 'number' ? score.toFixed(2) : '—';
        scoreEl.className = 'mod-score pending';
    } else {
        statusEl.textContent = '⏳';
        scoreEl.textContent = typeof score === 'number' ? score.toFixed(2) : '—';
        scoreEl.className = 'mod-score pending';
    }
    updateModalitySummary();
}

function toggleModalities() {
    const toggle = document.getElementById('modalityToggle');
    const list = document.getElementById('modalityList');
    toggle.classList.toggle('open');
    list.classList.toggle('open');
}


function updateModalitySummary() {
    // NOTE: 'modDidit' is intentionally OMITTED from this count. Didit fail-closes — when
    // the bound still is empty the backend may not return a face_liveness_didit modality at
    // all, so its tile can legitimately stay ⏳. Counting a perpetually-pending tile would
    // freeze this header at "Checking…" forever. The Didit row still renders + expands on
    // its own; it just doesn't gate the headline pass count. (Don't "fix" this.)
    // 'modFinger' + 'modDuress' are intentionally OMITTED — they are ADVISORY (never gate the
    // verdict; see updateModality). Their neutral '•' dot isn't a pass/fail, so counting them in
    // the "X/Y passed" headline would both misrepresent the gate AND freeze it at "Checking…"
    // (a '•' counts as neither ✓ nor ✗). 'modDidit' is omitted for the fail-closes reason above.
    const mods = ['modFace', 'modDeepfake', 'modVoice', 'modLipSync', 'modChallenge', 'modFinger'];
    let passed = 0, failed = 0, pending = 0;
    mods.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const status = el.querySelector('.mod-status');
        if (status.textContent === '✓') passed++;
        else if (status.textContent === '✗' || status.textContent === '⚠') failed++;
        else pending++;
    });
    const summary = document.getElementById('modalitySummary');
    if (!summary) return;
    if (pending > 0) {
        summary.textContent = 'Checking...';
        summary.className = 'toggle-summary';
    } else if (failed > 0) {
        summary.textContent = `${passed}/${passed+failed} passed`;
        summary.className = 'toggle-summary has-fail';
    } else {
        summary.textContent = `${passed}/${passed+failed} passed`;
        summary.className = 'toggle-summary';
    }
}

// INTEGRITY: reset every modality tile to PENDING + clear the prior run's detail, so a
// re-auth can never display a stale pass while the new verification is still computing.
// Mirrors updateModality's pending branch; updateModalitySummary then recomputes to "Checking…".
function resetModalities() {
    var ids = ['modFace', 'modDidit', 'modDeepfake', 'modVoice', 'modLipSync', 'modChallenge', 'modFinger', 'modDuress'];
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var statusEl = el.querySelector('.mod-status');
        var scoreEl = el.querySelector('.mod-score');
        if (statusEl) { statusEl.textContent = '⏳'; statusEl.style.color = ''; }
        if (scoreEl) { scoreEl.textContent = '—'; scoreEl.className = 'mod-score pending'; }
        el.classList.remove('open');   // F-AUTH-UX-POLISH (1): collapse rows (caret back to ▸) on re-auth
        var dd = el.querySelector('.mod-detail-expand');
        if (dd) dd.innerHTML = '';   // drop the prior run's Heard/Expected/etc. detail lines
    });
    try { updateModalitySummary(); } catch(_) {}   // all pending → "Checking…"
}

// F-563 belt-and-suspenders: hide + CLEAR the guided-flow DOM (panel, say-cover, progress dots)
// so stale prompts/numbers from a prior run can't leak into a new session's phrase phase. The
// re-auth reload moots this for re-auth, but it protects the first run + any non-reload re-entry.
function resetGuidedUI() {
    ['vacGuided', 'vacSayView', 'digitStrip', 'vacEqGreeting'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var p = document.getElementById('vacGuidedPrompt'); if (p) p.textContent = '';
    var s = document.getElementById('vacGuidedSub'); if (s) s.textContent = '';
    var w = document.getElementById('vacSayWord'); if (w) w.textContent = '';
    var h = document.getElementById('vacSayHint'); if (h) h.textContent = '';
    var r = document.getElementById('digitStripRow'); if (r) r.innerHTML = '';
    try { document.getElementById('cameraBoxRec').classList.remove('show-hand-zone', 'hand-in-zone', 'hand-visible'); } catch(_) {}  // clear the hand-capture guide between sessions
    try { _hideNoMicRecovery(); } catch(_) {}   // clear any stale no-mic recovery panel from a prior run
    window.__vacNoMicDismissed = false;          // fresh per session — re-offer recovery if the mic is still out
    window.__vacVoiceSkipped = false;            // fresh per session — don't carry a prior "skip voice" choice
}

function toggleUnderHood() {
    const arrow = document.getElementById('hoodArrow');
    const list = document.getElementById('underHoodList');
    const isOpen = list.classList.contains('open');
    list.classList.toggle('open');
    arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// F-AUTH-UX-POLISH (1): one toggle path for the whole modality row. A single `.open` class
// on the .mod-result drives the caret rotation AND reveals whatever detail exists (the static
// .mod-desc and/or the dynamic engine .mod-detail-expand added by updateModality) — so the
// caret's ▸/▾ state always matches whether the row is open, regardless of which detail is shown.
function toggleModRow(el) {
    if (el) el.classList.toggle('open');
}

function populateUnderHood(authData) {
    const bio = authData.biometric_verification;
    const mods = bio?.modalities || [];
    const el = document.getElementById('hoodContent');
    if (!el) return;

    let html = '';

    const face = mods.find(m => m.name === 'face_liveness');
    const df = mods.find(m => m.name === 'deepfake_detection');
    const ls = mods.find(m => m.name === 'lip_sync');

    if (face?.provider === 'gemini' || df?.provider === 'gemini') {
        html += `<div class="hood-section"><div class="hood-label">Gemini 2.5 Flash — Vision Analysis <span class="hood-provider">gemini</span></div>`;
        if (face?.detail?.person_description) {
            html += `<div class="hood-value">"${face.detail.person_description}"</div>`;
        }
        html += `<div class="hood-value" style="color: var(--text-tertiary); font-size: 10px;">`;
        html += `Face: ${face?.detail?.face_detected ? '✓ detected' : '✗'} · Blink: ${face?.detail?.blink_detected ? '✓' : '—'}`;
        if (df?.detail) {
            const dfLikelihood = typeof df.detail.deepfake_likelihood === 'number' ? (df.detail.deepfake_likelihood * 100).toFixed(0) : '0';
            html += ` · Deepfake: ${dfLikelihood}% likelihood`;
            if (df.detail.artifacts?.length > 0) html += ` (${df.detail.artifacts.join(', ')})`;
        }
        html += `</div>`;
        if (ls?.detail?.visual_speech?.estimated_words) {
            html += `<div class="hood-value" style="margin-top: 4px;">Lip reading: "${ls.detail.visual_speech.estimated_words}"</div>`;
        }
        html += `</div>`;
    }

    const voice = mods.find(m => m.name === 'voiceprint');
    const challenge = mods.find(m => m.name === 'challenge_response');

    if (voice?.provider === 'deepgram_nova3') {
        html += `<div class="hood-section"><div class="hood-label">Deepgram Nova-3 — Speech Analysis <span class="hood-provider">deepgram</span></div>`;
        if (voice.detail?.transcript) {
            html += `<div class="hood-value">Heard: "${voice.detail.transcript}"</div>`;
        }
        html += `<div class="hood-value" style="color: var(--text-tertiary); font-size: 10px;">`;
        html += `Confidence: ${(voice.score * 100).toFixed(0)}% · Words: ${voice.detail?.word_count || 0}`;
        if (challenge) {
            html += ` · Match: ${(challenge.score * 100).toFixed(0)}%`;
        }
        html += `</div>`;
        if (challenge?.detail?.expected) {
            html += `<div class="hood-value" style="margin-top: 4px; font-size: 10px; color: var(--text-quaternary);">Expected: "${challenge.detail.expected}"</div>`;
        }
        html += `</div>`;
    }

    const finger = mods.find(m => m.name === 'finger_gesture');
    if (finger) {
        html += `<div class="hood-section"><div class="hood-label">Finger Gesture Verification <span class="hood-provider">gemini</span></div>`;
        const seen = finger.detail?.digits_seen || [];
        const expected = finger.detail?.digits_expected || [];
        html += `<div class="hood-value" style="font-size: 10px;">`;
        html += `Expected: [${expected.join(', ')}] \u00b7 Seen: [${seen.join(', ')}]`;
        html += ` \u00b7 Hand near face: ${finger.detail?.hand_near_face ? '\u2713' : '\u2717'}`;
        html += ` \u00b7 Score: ${(finger.score * 100).toFixed(0)}%`;
        html += `</div></div>`;
    }

    if (bio?.trust_breakdown) {
        html += `<div class="hood-section"><div class="hood-label">Trust Score Breakdown</div>`;
        html += `<div class="hood-value" style="font-size: 10px;">`;
        const parts = Object.entries(bio.trust_breakdown).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toFixed(2) : v}`);
        html += parts.join(' · ');
        html += `</div></div>`;
    }

    html += `<div class="hood-section" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);">`;
    html += `<div style="font-size: 10px; color: var(--text-quaternary);">Biometric engines shared with <a href="https://folioai.com" target="_blank" style="color: var(--accent); text-decoration: none;">folioAI</a> — AI-powered video reflection and practice.</div>`;
    html += `</div>`;

    el.innerHTML = html || '<div style="color: var(--text-quaternary);">No engine data available.</div>';
    document.getElementById('hoodSummary').textContent = bio?.method?.includes('real') ? 'Gemini + Deepgram' : 'Simulated';
}



// ========== retry UI ==========

// Show retry with specific fail reasons
function showRetry(result) {
    retryAttempts++;
    const retryEl = document.getElementById('retrySection');
    retryEl.style.display = 'block';

    // Collect failed modalities
    const mods = result.biometric_verification?.modalities || [];
    const failed = mods.filter(m => m.status === 'failed' || m.status === 'error');

    // S110 UX fix: separate OUR-FAULT service errors (Gemini/engine hiccup) from
    // GENUINE user-side mismatches. A security product should never show a user a
    // wall of red "service unavailable" — that reads as "you were rejected" when
    // the fault is ours. If the ONLY problems are service errors, show a calm,
    // reassuring message and auto-retry silently instead of a red failure panel.
    const serviceErrors = failed.filter(m => m.status === 'error');
    const realFailures  = failed.filter(m => m.status === 'failed');
    const onlyServiceErrors = serviceErrors.length > 0 && realFailures.length === 0;

    if (onlyServiceErrors) {
        const stepEl = document.getElementById('progressStep');
        const detailEl = document.getElementById('progressDetail');
        const ringEl = document.getElementById('progressRing');
        try {
            if (stepEl) stepEl.textContent = 'Just a moment…';
            if (detailEl) detailEl.textContent = 'A couple of checks couldn\u2019t run just now \u2014 that\u2019s on our side, not yours. Retrying automatically.';
            if (ringEl) ringEl.style.stroke = 'var(--teal)';
        } catch(_) {}
        // Hide the alarming red "WHY IT FAILED" card + the per-modality red rows context.
        try { document.getElementById('failReasons').parentElement.style.display = 'none'; } catch(_) {}
        const verifiedCount = mods.filter(m => m.status === 'passed').length;
        document.getElementById('retryTipsList').innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;color:var(--text-secondary)">'
          + '<span style="display:inline-block;width:14px;height:14px;border:2px solid var(--teal);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></span>'
          + 'Re-running the checks that didn\u2019t respond' + (verifiedCount ? ' \u2014 ' + verifiedCount + ' already passed' : '') + '\u2026</div>';
        // Soften the retry button + auto-retry after a short, honest pause.
        const retryBtn = document.querySelector('#retrySection button[onclick="retryVerification()"]');
        if (retryBtn) retryBtn.textContent = 'Retry now';
        document.getElementById('retryCount').textContent = retryAttempts > 1 ? 'Attempt ' + retryAttempts + ' of ' + MAX_RETRIES : '';
        if (retryAttempts < MAX_RETRIES) {
            if (window.__vacAutoRetry) clearTimeout(window.__vacAutoRetry);
            window.__vacAutoRetry = setTimeout(function(){ try { retryVerification(true); } catch(_){} }, 2500);  // true = AUTO: auto-proceed through the warmed pre-flight
        }
        return; // do NOT fall through to the red failure panel
    }

    // VERDICT-EVIDENCE COHERENCE (task-515 P0-2, ported from vac-protocol
    // b923dc3/6afc21c): derive the displayed reason from result.verdict.reasons
    // (compute_honest_verdict's own authoritative output) instead of each
    // modality's own `status` field — duress.status is "alert"/"clear" (never
    // "failed"/"error"), and deepfake_detection.status can disagree with the
    // deepfake_likelihood float the verdict actually gates on, so a duress- or
    // deepfake-only deny left `failed` (above) empty and fell through to the
    // signal-less generic message this used to show.
    const { reasons, tips } = VacVerdictReasons.deriveFailureDisplay(result);

    if (reasons.length > 0) {
        document.getElementById('failReasons').innerHTML = reasons.map(r =>
            `<div style="margin-bottom: 4px;">${r}</div>`
        ).join('');
        document.getElementById('retryTipsList').innerHTML = [...new Set(tips)].map(t =>
            `<div style="margin-bottom: 4px;">${t}</div>`
        ).join('');
        // Suggest slower speed if finger or challenge failed
        const fingerFailed = failed.some(m => m.name === 'finger_gesture' && m.status === 'failed');
        const challengeFailed = failed.some(m => m.name === 'challenge_response' && m.status === 'failed');
        if ((fingerFailed || challengeFailed) && challengeSpeed !== 'relaxed') {
            document.getElementById('retryTipsList').innerHTML += '<div style="margin-top:10px;padding:10px 14px;background:rgba(45,212,191,0.04);border:1px solid rgba(45,212,191,0.15);border-radius:8px;"><strong style="color:var(--teal)">Try a slower speed</strong> — switch to <a href="#" onclick="setSpeed(\'relaxed\');this.parentElement.style.display=\'none\';return false;" style="color:var(--teal);text-decoration:underline;font-weight:600;">Relaxed mode</a> for more time on each step.</div>';
        }
    } else {
        document.getElementById('failReasons').textContent = 'Verification did not reach the required trust threshold.';
        document.getElementById('retryTipsList').textContent = 'Ensure good lighting, speak clearly, and look directly at the camera.';
    }

    document.getElementById('retryCount').textContent = retryAttempts > 1 ? 'Attempt ' + retryAttempts + ' of ' + MAX_RETRIES : '';

    // After max retries, offer "continue anyway" (mints partial chain)
    if (retryAttempts >= MAX_RETRIES) {
        document.getElementById('btnContinueAnyway').style.display = 'inline-flex';
    }
}



// ========== no-mic recovery + retry ==========

// F-563 recoverability: a verification flow must NEVER have an unescapable state. When the mic is
// genuinely unavailable mid-flow (audioAnalyser null → the phrase fail-open advances past the
// greeting, gesture-only), SURFACE it honestly + offer reachable exits — reusing what we already
// have (the pre-flight mic test, reached via the reload primitive) rather than rebuilding recovery UI.
// F-720: shown when the recorder stops before finishFingerPhase schedules it (stream/track death).
// Fail-closed: no POST, no gate bypass. Single action: restart.
function _showCaptureDiedRecovery() {
    if (document.getElementById('vacCaptureDied')) return; // idempotent
    var host = document.getElementById('challengePanel');
    if (!host || !host.parentElement) return;
    var panel = document.createElement('div');
    panel.id = 'vacCaptureDied';
    panel.style.cssText = 'margin:10px 0 0;padding:12px 14px;background:rgba(220,38,38,0.08);border:1px solid var(--danger,#dc2626);border-radius:10px;text-align:center;';
    panel.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:var(--danger,#dc2626);margin-bottom:4px;">Camera or microphone dropped — restart verification</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">Your camera or microphone stopped unexpectedly before the recording completed. Please restart to try again.</div>' +
        '<button onclick="VACReauth.reload({auto:false,keepRetryBudget:false})" style="display:block;width:100%;padding:10px 12px;background:var(--purple,#7c5cfc);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Restart verification</button>';
    host.parentElement.insertBefore(panel, host.nextSibling);
    try { vacDebug('capture_died_recovery_shown'); } catch(_) {}
}
function _showNoMicRecovery(reason) {
    if (window.__vacNoMicDismissed) return;             // user chose "Continue — skip voice" → don't nag again this session
    if (document.getElementById('vacNoMic')) return;    // idempotent — show once, persist until acted on
    var host = document.getElementById('challengePanel');
    if (!host || !host.parentElement) return;
    // 'quiet' = a CONNECTED-but-near-silent mic (Finding/silent-mic) → "we can't hear you";
    // default ('no_mic' / null analyser) → "No microphone detected". Same actions either way.
    var _quiet = (reason === 'quiet');
    var _title = _quiet ? 'We can’t hear you — check your mic' : 'No microphone detected — voice check skipped';
    var panel = document.createElement('div');
    panel.id = 'vacNoMic';
    panel.style.cssText = 'margin:10px 0 0;padding:12px 14px;background:rgba(210,153,34,0.08);border:1px solid var(--warning,#D29922);border-radius:10px;text-align:center;';
    panel.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:var(--warning,#D29922);margin-bottom:4px;">' + _title + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">' + (_quiet ? 'Your mic is connected but very quiet. Speak up, move closer, or pick a different mic — or continue (your gestures are still verified, and our servers re-check voice from the recording).' : 'Your gestures are still verified, and our servers re-check voice from the recording. Choose how to continue:') + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">' +
          '<button onclick="VACReauth.reload({auto:false,keepRetryBudget:false})" style="flex:1;min-width:150px;padding:9px 12px;background:var(--purple,#7c5cfc);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">🔄 Reconnect mic &amp; retry</button>' +
          '<button onclick="_dismissNoMic()" style="flex:1;min-width:150px;padding:9px 12px;background:transparent;color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Continue — skip voice</button>' +
        '</div>' +
        '<div style="margin-top:8px;"><a href="#" onclick="VACReauth.reload({auto:false,keepRetryBudget:false});return false;" style="font-size:11px;color:var(--text-tertiary);text-decoration:underline;">Start over</a></div>';
    host.parentElement.insertBefore(panel, host.nextSibling);
    try { vacDebug('no_mic_recovery_shown'); } catch(_) {}
}
function _hideNoMicRecovery() {   // generic cleanup hide (finish / reset) — does NOT mark the user's choice
    var p = document.getElementById('vacNoMic');
    if (p) p.remove();
}
// User explicitly chose "Continue — skip voice": dismiss AND don't re-show this session (the
// phrase tick would otherwise recreate it every 200ms). Reset per session in resetGuidedUI.
function _dismissNoMic() {
    window.__vacNoMicDismissed = true;
    window.__vacVoiceSkipped = true;   // F-563: "Continue — skip voice" → the gates degrade to gesture-only (greeting advances, digits don't wait on voice). Honest: voice pacing is skipped; Gemini still validates voice server-side.
    _hideNoMicRecovery();
    try { vacDebug('no_mic_recovery_dismissed'); } catch(_) {}
}

async function retryVerification(auto) {
    if (retryAttempts >= MAX_RETRIES) return;
    // F-789: if the previous failure was transport-only (the blob never reached the server),
    // the ceremony was already complete — re-upload without re-recording.
    if (window.__vacLastVerifyBlob && window.__vacLastVerifyFailWasTransport) {
        // Reset error UI before re-uploading: hides retry button (prevents double-tap concurrent
        // runRealVerification calls) and clears red ring left by the failed attempt.
        var _rEl = document.getElementById('retrySection');
        if (_rEl) _rEl.style.display = 'none';
        var _rRing = document.getElementById('progressRing');
        if (_rRing) _rRing.style.stroke = '';
        await runRealVerification(window.__vacLastVerifyBlob);
        return;
    }
    // Reload to a guaranteed fresh start. Keeps the retry budget; auto-retry (service errors)
    // re-proceeds through the warmed pre-flight after boot (the auto flag rides in the blob).
    VACReauth.reload({ auto: !!auto, keepRetryBudget: true, retryAttempts: retryAttempts });
}



// ========== biometric reset ==========

// S111 #1+#4: shared reset for a biometric RE-ENTRY. The old refreshVerification()
// only did goToStep(1), which flips the section but resets nothing — so a second
// attempt kept the prior run's AUTHENTICATED badge (set by showSuccess) and its
// hand-skeleton canvas on screen (#1), AND skipped requestCamera()->startAVChecks(),
// the F-559 preflight that warms MediaPipe before recording, so the detector
// cold-started on the first real digit (#4, the "hang"). This puts the page back to
// a clean first-run-equivalent state.
function resetBiometricUI(preserveRetryBudget) {
    // 1. Nav badge: back to the un-authenticated state. showSuccess() set text
    //    'AUTHENTICATED' + inline teal styling; clear the inline so the .nav-mode
    //    class styling (purple "AUTHENTICATE") applies again.
    var nav = document.getElementById('navStatus');
    if (nav) { nav.textContent = 'AUTHENTICATE'; nav.style.color = ''; nav.style.background = ''; nav.style.borderColor = ''; }
    window.__vacAutoProceedChallenge = false;   // clear any stale auto-proceed (retry re-sets it right after; refresh leaves it off)
    window.__vacLastVerifyBlob = null;           // F-789: clear stale blob so a new ceremony can't re-upload a prior full-tier blob
    window.__vacLastVerifyFailWasTransport = false;
    // 2. Clear both hand-skeleton canvases so the prior run's overlay doesn't linger
    //    (their clearRect only runs inside the live draw loops, which aren't running yet).
    ['handOverlay', 'avHandOverlay'].forEach(function(id) {
        var cv = document.getElementById(id);
        if (cv && cv.getContext) { try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch(_) {} }
    });
    // 3. Reset the AV preflight gate so light/mic/hand must re-pass — this is what
    //    re-runs the hand preflight that warms the detector.
    avChecks = { face: false, light: false, mic: false, hand: false };
    // 4. Restore the camera button to its first-run entry point. Run 1 rewired
    //    btnCamera.onclick to goToChallenge (requestCamera resets it again at its end).
    var btnCam = document.getElementById('btnCamera');
    if (btnCam) { btnCam.onclick = requestCamera; btnCam.disabled = false; btnCam.textContent = 'Enable Camera & Microphone'; }
    // 5. Stop any still-live tracks from the previous attempt before requestCamera
    //    acquires a fresh stream (avoids a leaked camera/mic).
    try { if (mediaStream) { mediaStream.getTracks().forEach(function(t) { t.stop(); }); } } catch(_) {}
    // 6. Reset the retry budget + hide stale failure UI so the new run is truly
    //    first-run-equivalent (codex P2). Without this, a refresh after earlier failed
    //    attempts inherits the old MAX_RETRIES budget and the prior retry section /
    //    "Continue Anyway" button can resurface. NOTE: this only RESETS state for the
    //    new run — it does NOT change the addendum-13 #3 "Continue Anyway" integrity
    //    logic (showSuccess-after-failure), which is a separate, still-pending fix.
    if (!preserveRetryBudget) retryAttempts = 0;   // a RETRY must keep counting attempts; a fresh refresh resets
    var retrySec = document.getElementById('retrySection');
    if (retrySec) retrySec.style.display = 'none';
    var contBtn = document.getElementById('btnContinueAnyway');
    if (contBtn) contBtn.style.display = 'none';
}



// ========== adaptive modality requirements + audio monitor + helpers ==========

// Fetch adaptive modality requirements based on trust relationship
async function fetchModalityRequirements() {
    const email = userData().email;
    if (!email) return;
    try {
        const resp = await fetch(`${API_BASE}/v1/modality-requirements/${encodeURIComponent(email)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const policy = data.modality_policy;
        if (!policy) return;

        // Show adaptive bar ONLY when trust graph actually reduces requirements
        // First auth = no trust data = full verification = don't show confusing "3 of 6" message
        const bar = document.getElementById('adaptiveAuthBar');
        const lvl = policy.label.toLowerCase();
        if (policy.total_required < policy.total_available && data.trust_relationship?.total_vouches > 0) {
            bar.className = `adaptive-auth-bar ${lvl}`;
            bar.textContent = `${policy.label}: ${policy.total_required} of ${policy.total_available} modalities required`;
            bar.style.display = 'block';
        } else {
            bar.style.display = 'none';
        }

        // Update chips: dim optional/can-skip
        const chips = document.querySelectorAll('#modalityChips .mod-chip');
        chips.forEach(chip => {
            const mod = chip.dataset.mod;
            chip.classList.remove('optional', 'recommended');
            if (policy.can_skip && policy.can_skip.includes(mod)) {
                chip.classList.add('optional');
            } else if (policy.optional && policy.optional.includes(mod)) {
                chip.classList.add('optional');
            } else if (policy.recommended && policy.recommended.includes(mod)) {
                chip.classList.add('recommended');
            }
        });
    } catch (e) {
        // Silently fail — default to showing all modalities as required
        console.warn('Could not fetch modality requirements:', e);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// F-563 (2): LIVE EQUALISER — visualises the mic level the system is already analysing, so the
// user always has proof "we hear you" (and a mic-dead indicator: speak, bars don't move = no mic,
// complementing the no-mic recovery). DISPLAY-ONLY — it reads the audio level and writes only bar
// heights/colours; it does NOT touch the voice gate (silence→onset binding) in any way.
function _renderEqualiser(rms) {
    var mult = [0.5, 0.85, 1, 0.85, 0.5];
    var voiced = rms > 0.07;   // task-644: 0.12→0.07, mirrors time-domain VAD_SPEECH_RMS_FALLBACK — colour cue only
    ['vacEqGreeting', 'vacSayEq'].forEach(function(id) {
        var host = document.getElementById(id);
        if (!host) return;
        var bars = host.children;
        for (var i = 0; i < bars.length; i++) {
            var h = Math.max(3, Math.min(28, rms * 130 * (mult[i] || 1)));
            bars[i].style.height = h + 'px';
            bars[i].style.background = voiced ? 'var(--teal,#2dd4bf)' : 'var(--text-quaternary,#6E7681)';
        }
    });
}

// Audio level monitoring (F-755d — VAD onset instrumentation, task-515 P0-1
// ported from vac-protocol b923dc3/a348465)
//
// ROOT CAUSE (VAD onset loss, live repro: indoor speech w/ mild aircon pinned the
// old "RMS" readout at ~1% through real speech): this DISPLAY-ONLY monitor (ab0-4
// bars + _renderEqualiser — never the real per-digit VAD gate below, which has its
// own independently-tuned ambient-relative/voice-band-ratio system) computed its
// "RMS" from getByteFrequencyData() — the smoothed frequency-MAGNITUDE spectrum —
// averaged across ALL 128 bins of a 256-point FFT. Voice energy sits in a handful
// of low bins; the other ~110 bins are near-silent, so sqrt(mean-of-squares) over
// the full spectrum systematically dilutes real speech toward zero. Fix: read the
// raw TIME-DOMAIN waveform (getByteTimeDomainData, unaffected by smoothing) and
// compute true sample RMS — the same domain the (correctly-implemented) pre-flight
// AV mic check already uses (see startAVChecks() above).
//
// Gate: a fixed 5% absolute threshold silently fails once ambient noise (e.g.
// aircon hum) sits anywhere near it. Replaced with an onset-sensitive gate — an
// adapting ambient noise-floor estimate (EMA) plus a require-above-floor-by-delta
// trigger, so onset detection tracks the actual room instead of one hardcoded
// number. Two adaptation rates (not a hard freeze-while-active): FAST while quiet,
// but the floor still DRIFTS slowly while onset is active (AUDIO_FLOOR_DRIFT_ALPHA)
// — a hard freeze can never release in a room whose steady ambient sits above the
// seeded floor (a348465).
function startAudioMonitor() {
    try {
        // Belt-and-suspenders (the reload already guarantees a fresh context for re-auth, but this
        // protects the FIRST run and any non-reload path): close any prior context so repeated
        // entries can't accumulate AudioContexts and hit the browser's ~6-limit (which made
        // `new AudioContext()` throw → audioAnalyser stayed null → the phrase fail-open bypass).
        if (audioContext) { try { audioContext.close(); } catch(_) {} audioContext = null; }
        // Stop any prior monitor stream clone so we don't leak live audio tracks on rewire
        if (_monitorStream) { try { _monitorStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_) {} _monitorStream = null; }
        if (!mediaStream) { console.error('[VAC][AUDIO] startAudioMonitor: no mediaStream — voice gate will be OFF'); return; }
        // S154 (quick-auth-after-full-ceremony deafness): the full path's teardown can END the
        // stream's audio track while the mediaStream global stays truthy — cloning an ended
        // track yields permanent zeros: a deaf gate with no error anywhere. Check track state,
        // report it (telemetry names the truth at every gate start), and reacquire audio-only
        // if dead (permission already granted → silent).
        var _amTrack = null; try { _amTrack = mediaStream.getAudioTracks()[0] || null; } catch(_) {}
        var _amState = _amTrack ? _amTrack.readyState : 'none';
        try { vacDebug('audio_monitor_start', null, { track: _amState }); } catch(_) {}
        if (_amState !== 'live') {
            try {
                var _p = navigator.mediaDevices.getUserMedia({ audio: true });
                // Synchronous path continues with the (dead) stream this frame; swap in the fresh
                // track as soon as it lands and rebuild the analyser chain against it.
                _p.then(function(_fresh){
                    try {
                        mediaStream = _fresh.getAudioTracks().length ? new MediaStream([_fresh.getAudioTracks()[0]].concat((mediaStream.getVideoTracks&&mediaStream.getVideoTracks())||[])) : mediaStream;
                        try { vacDebug('audio_monitor_start', 'reacquired', { track: 'live' }); } catch(_) {}
                        startAudioMonitor();  // rebuild against the live track (prior context closed at top)
                    } catch(_e2) {}
                }).catch(function(_ge){ try { vacDebug('audio_monitor_start', 'reacquire_failed', { err: String(_ge && _ge.name || _ge).slice(0,60) }); } catch(_) {} });
            } catch(_) {}
        }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') { audioContext.resume().catch(function(){}); }  // some browsers start suspended → no audio frames until resumed
        // Assign the analyser BEFORE the (throwable) stream clone/connect, so a failure here leaves a
        // live (if briefly disconnected) analyser → the phrase gate HOLDS for voice instead of
        // fail-opening on a null analyser.
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioAnalyser.smoothingTimeConstant = 0.15;  // S139-v2: low smoothing so inter-tap dips register; default 0.8 kept two ~100ms taps' residual above threshold continuously, defeating the 250ms sustain gate
        _monitorStream = mediaStream.clone();
        const source = audioContext.createMediaStreamSource(_monitorStream);
        source.connect(audioAnalyser);

        audioNoiseFloor = 0.01;
        _adaptLastFloor = 0.01;  // S157 C1: keep adapt tracking in sync with floor reset (prevents false explain-as-you-adapt)
        audioOnsetActive = false;
        const dataArray = new Uint8Array(audioAnalyser.fftSize);
        const bars = [0,1,2,3,4].map(i => document.getElementById(`ab${i}`));
        const readout = document.getElementById('audioRmsReadout');

        var _flatlineStart = 0;  // S157 C1: flatline start timestamp (resets on rebuild)
        function updateLevels() {
            audioAnalyser.getByteTimeDomainData(dataArray);
            // True time-domain RMS of the waveform (samples are unsigned bytes
            // centered on 128) — not smoothed, not diluted across empty bins.
            let sumSq = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const dev = (dataArray[i] - 128) / 128;
                sumSq += dev * dev;
            }
            const rms = Math.sqrt(sumSq / dataArray.length);

            // S157 C1: flatline rewire — analyser tapped to dead/replaced stream.
            // Threshold 0.001 (not 0.003): Chrome injects ~0.001-0.003 privacy noise into working
            // analysers; truly dead streams return all-128 bytes → rms = 0 exactly. 0.001 discriminates.
            if (rms < 0.001) {
                // Suspended context also produces rms=0 (iOS background, desktop power-save).
                // Attempt resume on every flatline tick so it has time to recover before rewire fires.
                try { if (audioContext && audioContext.state === 'suspended') audioContext.resume(); } catch(_) {}
                if (_flatlineStart === 0) _flatlineStart = performance.now();
                if (!_audioRewireInFlight && _audioRewireCount < 3 &&
                        (performance.now() - _audioLastRewireAt) > 5000 &&
                        (performance.now() - _flatlineStart) >= 1500) {
                    var _rwCtxOk = false, _rwTrkOk = false;
                    try { _rwCtxOk = !!(audioContext && audioContext.state === 'running'); } catch(_) {}
                    try {
                        var _rwt = _monitorStream ? _monitorStream.getAudioTracks()[0] : null;
                        _rwTrkOk = !!(_rwt && _rwt.readyState === 'live' && !_rwt.muted);
                    } catch(_) {}
                    if (_rwCtxOk && _rwTrkOk) {
                        _audioRewireInFlight = true;
                        _audioRewireCount++;
                        _audioLastRewireAt = performance.now();
                        try { vacDebug('audio_rewire', null, { count: _audioRewireCount, elapsed: Math.round(performance.now() - _flatlineStart) }); } catch(_) {}
                        setTimeout(function() {
                            // Guard: ceremony was cancelled (stopAudioMonitor → audioAnalyser = null)
                            // before this callback fired — skip to avoid zombie AudioContext.
                            // mediaStream is NOT nulled by stopAudioMonitor (only its tracks are stopped),
                            // so test audioAnalyser alone.
                            if (audioAnalyser === null) { _audioRewireInFlight = false; return; }
                            try { startAudioMonitor(); } catch(_e) {}
                            _audioRewireInFlight = false;
                        }, 0);
                        return;
                    }
                }
            } else {
                _flatlineStart = 0;
            }

            // Onset-sensitive gate, relative to an adapting ambient floor.
            if (!audioOnsetActive && rms > audioNoiseFloor + AUDIO_ONSET_DELTA) {
                audioOnsetActive = true;
            } else if (audioOnsetActive && rms < audioNoiseFloor + AUDIO_ONSET_RELEASE) {
                audioOnsetActive = false;
            }
            // Track the floor at all times, just far more slowly while onset is
            // active — a normal utterance is too short/rms-transient to move it at
            // the drift rate, but a sustained loud room still recovers (a348465).
            const floorAlpha = audioOnsetActive ? AUDIO_FLOOR_DRIFT_ALPHA : AUDIO_FLOOR_EMA_ALPHA;
            audioNoiseFloor += (rms - audioNoiseFloor) * floorAlpha;

            try { _renderEqualiser(rms); } catch(_) {}   // F-563 (2): live eq off the same mic level (display-only)

            for (let i = 0; i < 5; i++) {
                const val = audioOnsetActive ? Math.min(1, rms * 4) : 0;
                const h = Math.max(2, val * 20);
                if (bars[i]) bars[i].style.height = h + 'px';
            }
            if (readout) {
                // S157: audio state sensor — ctx state + the monitored
                // track's liveness/mute rendered live, so a pinned meter self-explains:
                //   c:r = context running, c:s = suspended · t:l = track live, t:m = MUTED,
                //   t:e = ended, t:? = no track handle. A deaf meter with c:r/t:l means the
                //   analyser taps a replaced (dead) stream; t:m means OS device contention.
                var _st = 'c:?';
                try { _st = 'c:' + (audioContext ? audioContext.state.charAt(0) : '?'); } catch(_) {}
                var _tk = 't:?';
                try {
                    var _mt = _monitorStream ? _monitorStream.getAudioTracks()[0] : null;
                    if (_mt) _tk = 't:' + (_mt.readyState === 'ended' ? 'e' : (_mt.muted ? 'm' : 'l'));
                } catch(_) {}
                if (readout.getAttribute('data-adapt-msg')) {
                    readout.textContent = 'Noisy environment \u2014 listening level adjusted';
                } else {
                    readout.textContent = 'RMS ' + Math.round(rms * 100) + '% \u00b7 s157c1 \u00b7 ' + _st + ' ' + _tk;
                }
                readout.classList.toggle('onset-active', audioOnsetActive);
            }
            audioAnimFrame = requestAnimationFrame(updateLevels);
        }
        updateLevels();
    } catch (e) {
        // CLEAR the analyser on any partial-setup failure (clone/createMediaStreamSource/connect
        // can throw after it was assigned). A truthy-but-DISCONNECTED analyser would make the gates
        // hold to the phrase hard cap then wait on a dead VAD; null is correct — it triggers the
        // intended W4.1 graceful degradation (gesture-only + "(voice gate off)" note) + the loud log
        // (codex). The accumulation root is fixed by close-prior-context above + the re-auth reload.
        audioAnalyser = null;
        if (audioContext) { try { audioContext.close(); } catch(_) {} audioContext = null; }
        console.error('[VAC][AUDIO] startAudioMonitor FAILED — voice gate degrades to off:', e);
        try { vacDebug('audio_monitor_failed', String(e && e.message || e), { has_stream: !!mediaStream }); } catch(_) {}
    }
}

function stopAudioMonitor() {
    if (audioAnimFrame) cancelAnimationFrame(audioAnimFrame);
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
    audioAnalyser = null;
    audioOnsetActive = false;
    // S157 C1: clear adapt timer so it cannot fire into a subsequent ceremony's readout
    if (_adaptExplainTimer) { clearTimeout(_adaptExplainTimer); _adaptExplainTimer = null; }
    // S157 C1: stop the monitor clone so we don't leave a live audio track after ceremony end
    if (_monitorStream) { try { _monitorStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_) {} _monitorStream = null; }
    // Reset rewire counters so each new ceremony gets a fresh budget of 3 recovery attempts
    _audioRewireCount = 0; _audioLastRewireAt = 0; _audioRewireInFlight = false;
    document.getElementById('audioLevel').style.display = 'none';
}



// ===================== ceremony UI (DOM + CSS, extracted verbatim from auth.html) =====================
const CEREMONY_HTML = `<!-- STEP 1: Camera Access -->
<div class="step-section" id="step1">
    <div class="header">
        <button onclick="VACReauth.cancel()" class="btn-back" aria-label="Back to Identity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
            Back
        </button>
        <div class="header-eyebrow">Step 2 of 4</div>
        <div class="header-title">Camera & Mic</div>
        <div class="header-sub" id="step2HeaderSub">Let&rsquo;s check your camera, mic &amp; light — hold your hand up beside your cheek.<br><span style="opacity:0.7;font-weight:500;">Next step: you&rsquo;ll say a greeting and show a few numbers.</span></div>
        <div id="deviceInfo" style="font-family: var(--mono); font-size: 10px; color: var(--text-quaternary); margin-top: 4px;"></div>
    </div>
    <div class="camera-container" id="cameraBox">
        <video id="videoPreview" autoplay playsinline muted></video>
        <canvas id="avHandOverlay" style="position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;z-index:4;"></canvas>
        <div class="camera-overlay">
            <div class="camera-corners"></div>
            <div class="camera-corners-bottom"></div>
            <div class="face-oval" id="faceOval">
                <svg viewBox="0 0 180 240" width="100%" height="100%">
                    <ellipse class="face-oval-ring" cx="90" cy="120" rx="75" ry="105"/>
                </svg>
                <div class="face-oval-label" id="faceOvalLabel">Position face in oval</div>
            </div>
            <!-- Hand-capture guide for the PRE-FLIGHT hand test — identical to the one in the
                 recording container, so the practice screen prepares the user for the same
                 in-front-of-face constraint. Shown via show-hand-zone on #cameraBox. -->
            <div class="hand-zone" id="handZonePreflight">
                <div class="hand-zone-label">Hold hand beside your cheek</div>
            </div>
            <div class="camera-label" id="cameraLabel">AWAITING CAMERA</div>
        </div>
    </div>
    <!-- D-VERIFY-CHECKS-BELOW-FOLD: the live checklist (mic meter + guided step
         instruction + Light/Mic/Hand pills) now sits DIRECTLY under the camera, ABOVE
         the button — so it's in view without scrolling and the button's "Complete the
         checks above" copy is literally true (was rendered below the button before). -->
    <div id="preRecordChecklist" style="display:none; margin-top: clamp(6px, 1vh, 10px);">
        <!-- Mic test — prominent call to action -->
        <div id="avAudioBar" style="display:none; margin-bottom: 8px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;">
            <div id="avMicPrompt" style="display: flex; align-items: center; gap: 8px; font-size: clamp(12px, 1.4vw, 14px); color: var(--text-primary); font-weight: 500; margin-bottom: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                <span id="avMicPromptText">Speak now to test your microphone</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden;">
                    <div id="avAudioLevel" style="height: 100%; width: 0%; background: var(--success); border-radius: 6px; transition: width 75ms;"></div>
                </div>
                <span id="avAudioPct" style="font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); min-width: 30px; text-align: right;">0%</span>
            </div>
            <div id="avMicDevice" style="font-size: 11px; color: var(--text-quaternary); margin-top: 4px; display: none; font-family: var(--mono);"></div>
            <div id="avMicTip" style="font-size: 11px; color: var(--text-quaternary); margin-top: 4px; display: none;"></div>
            <button onclick="retryAVSetup()" style="display: inline-flex; align-items: center; gap: 5px; margin-top: 2px; padding: 4px 10px; font-size: 11px; color: var(--accent); background: none; border: 1px solid var(--accent); border-radius: 6px; cursor: pointer; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
                Refresh camera &amp; mic
            </button>
        </div>
        <!-- S110 (F-559): guided sequential pre-flight — tells the user exactly which
             check to satisfy next, one at a time, so the hand step (and its framing) is
             impossible to miss. Driven by avChecks in updateAVReady. -->
        <div id="avGuide" style="text-align:center;font-size:15px;font-weight:600;color:var(--text-primary);background:var(--purple-bg,rgba(108,92,231,0.08));border:1px solid var(--purple-border,rgba(108,92,231,0.25));border-radius:10px;padding:12px 16px;margin-bottom:10px;">Checking your camera…</div>
        <!-- Status pills — horizontal row -->
        <div style="display: flex; justify-content: space-between; gap: 6px;">
            <div id="avPillLight" class="av-pill"><span id="avLightIcon" class="av-pill-icon spinning"></span><span id="avLightLabel">Light</span><span id="avLuxValue" class="av-pill-value"></span></div>
            <div id="avPillMic" class="av-pill" style="flex:1.6;"><span id="avMicIcon" class="av-pill-icon spinning"></span><span id="avMicLabel">Mic</span><span id="avMicBar" style="display:inline-block;width:64px;height:8px;border-radius:4px;background:rgba(255,255,255,.10);position:relative;margin:0 3px;overflow:visible;flex:0 0 auto;"><span id="avMicBarFill" style="display:block;height:100%;width:0%;background:#8b97ad;border-radius:4px;transition:width 50ms linear;"></span><span style="position:absolute;top:-3px;bottom:-3px;left:40%;width:2px;background:#fbbf24;border-radius:1px;"></span></span><span id="avRmsReadout" class="av-pill-value"></span></div>
            <div id="avPillHand" class="av-pill"><span id="avHandIcon" class="av-pill-icon spinning"></span><span id="avHandLabel">Hand</span></div>
        </div>
        <div id="avHandHint" style="display:none;text-align:center;font-size:12px;color:var(--teal);margin-top:8px;font-weight:500;">Hold your hand up — we'll show you it being tracked</div>
        <div id="vacHandDbg" style="text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-quaternary);margin-top:2px;letter-spacing:0.5px;"></div>
    </div>
    <div class="privacy-statement">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L2 4v4c0 3.5 2.6 6.8 6 7.5 3.4-.7 6-4 6-7.5V4L8 1z" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M6 8l1.5 1.5L10 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>We store a text description of your appearance — <strong style="color:var(--text-secondary);">no photos or video are retained.</strong> Recording is analysed in real-time and discarded.</span>
    </div>
    <button class="btn-primary" id="btnCamera" onclick="requestCamera()">
        Enable Camera & Microphone
    </button>
    <div id="cameraError" class="error-msg" style="display:none;"></div>
    <div style="text-align: center; margin-top: 4px;">
        <div id="adaptiveAuthBar" class="adaptive-auth-bar standard" style="display:none;"></div>
        <div class="modalities-mini" style="justify-content: center; display: none;" id="modalityChips">
            <div class="mod-chip" data-mod="video_liveness"><span class="dot"></span>Face Liveness</div>
            <div class="mod-chip" data-mod="deepfake_detection"><span class="dot"></span>Deepfake Detection</div>
            <div class="mod-chip" data-mod="voice_biometric"><span class="dot"></span>Speech Match</div>
            <div class="mod-chip" data-mod="lip_sync"><span class="dot"></span>Lip-Sync</div>
            <div class="mod-chip" data-mod="otp_verification"><span class="dot"></span>Challenge Response</div>
            <div class="mod-chip" data-mod="finger_gesture"><span class="dot"></span>Finger Gesture</div>
        </div>
    </div>
</div>

<!-- STEP 2: Challenge + Recording -->
<div class="step-section" id="step2">
    <div class="header" style="padding-bottom: 16px;">
        <button onclick="VACReauth.toCamera()" class="btn-back" aria-label="Back to Camera">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
            Back
        </button>
        <div class="header-eyebrow">Step 3 of 4</div>
        <div class="header-title" id="step2Title">Complete the Challenge</div>
    </div>
    <!-- S110: persistent target-digit strip ABOVE the video so the numbers are always
         clear and never fade behind the hand/skeleton overlay -->
    <div id="digitStrip" style="display:none;margin:0 0 12px;text-align:center;">
        <div style="font-size:11px;color:var(--teal);font-family:var(--mono);letter-spacing:1.5px;font-weight:600;margin-bottom:8px;">YOUR PROGRESS</div>
        <div id="digitStripRow" style="display:flex;justify-content:center;gap:10px;"></div>
    </div>
    <!-- F-563 (2): BIG guided one-digit-at-a-time panel. Driven each frame off the EXISTING gate
         flags (gesture done = _qaGestureLatched; voice done = speechReady[i]) — NO gate change.
         The big current-digit prompt + the two ✓ lamps carry the flow; the small status below is
         now secondary. Hidden until the finger phase begins. -->
    <div id="vacGuided" style="display:none;margin:0 0 8px;text-align:center;">
        <div id="vacGuidedNumber" style="display:none;font-size:clamp(44px,12vw,72px);font-weight:800;color:var(--purple,#7c5cfc);line-height:1;margin-bottom:2px;"></div>
        <div id="vacGuidedPrompt" style="font-size:clamp(17px,4.5vw,24px);font-weight:800;color:var(--text-primary);line-height:1.15;min-height:1.15em;"></div>
        <div id="vacGuidedSub" style="font-size:clamp(12px,3.2vw,14px);color:var(--text-secondary);margin-top:4px;min-height:1.2em;"></div>
        <div style="display:flex;justify-content:center;gap:clamp(14px,5vw,28px);margin-top:8px;">
            <div id="vacGuidedGesture" style="display:flex;flex-direction:column;align-items:center;gap:3px;opacity:0.4;transition:opacity 0.2s;">
                <span class="vac-lamp" style="display:inline-flex;width:clamp(34px,9vw,44px);height:clamp(34px,9vw,44px);border-radius:50%;border:2px solid var(--border);align-items:center;justify-content:center;font-size:clamp(18px,5vw,22px);">G</span>
                <span style="font-size:10px;font-family:var(--mono);letter-spacing:0.5px;color:var(--text-tertiary);">GESTURE</span>
            </div>
            <div id="vacGuidedVoice" style="display:flex;flex-direction:column;align-items:center;gap:3px;opacity:0.4;transition:opacity 0.2s;">
                <span class="vac-lamp" style="display:inline-flex;width:clamp(34px,9vw,44px);height:clamp(34px,9vw,44px);border-radius:50%;border:2px solid var(--border);align-items:center;justify-content:center;font-size:clamp(18px,5vw,22px);">V</span>
                <span style="font-size:10px;font-family:var(--mono);letter-spacing:0.5px;color:var(--text-tertiary);">VOICE</span>
            </div>
        </div>
    </div>
    <div class="camera-container recording" id="cameraBoxRec">
        <video id="videoPreviewRec" autoplay playsinline muted></video>
        <canvas id="handOverlay" style="position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;z-index:4;"></canvas>
        <div id="framingHint" style="display:none;position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;background:rgba(210,153,34,0.92);color:#0D1117;font-weight:600;font-size:13px;padding:8px 14px;border-radius:8px;max-width:90%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.4);"></div>
        <div class="camera-overlay">
            <div class="camera-corners"></div>
            <div class="camera-corners-bottom"></div>
            <div class="face-oval">
                <svg viewBox="0 0 180 240" width="100%" height="100%">
                    <ellipse class="face-oval-ring" cx="90" cy="120" rx="75" ry="105"/>
                </svg>
            </div>
            <!-- Hand-capture guide: shown only during the gesture step. Tells the user
                 WHERE to hold the hand (in front of the face) — the same near-face zone
                 the server enforces for the hand_near_face anti-spoof property. -->
            <div class="hand-zone" id="handZone">
                <div class="hand-zone-label" id="handZoneLabel">Hold hand beside your cheek</div>
            </div>
            <div class="rec-indicator" id="recIndicator" style="display:none;">
                <span class="rec-dot"></span>REC
            </div>
            <div class="audio-level" id="audioLevel" style="display:none;">
                <div class="audio-bar" id="ab0" style="height:2px;"></div>
                <div class="audio-bar" id="ab1" style="height:2px;"></div>
                <div class="audio-bar" id="ab2" style="height:2px;"></div>
                <div class="audio-bar" id="ab3" style="height:2px;"></div>
                <div class="audio-bar" id="ab4" style="height:2px;"></div>
                <span class="audio-rms-readout" id="audioRmsReadout" title="Live mic RMS — instrumentation for onset debugging (F-755d)">RMS 0%</span>
            </div>
        </div>
        <!-- F-563 (2/latch): camera-free "Say N" view. An OPAQUE cover over the feed during the
             voice step — one thing per screen (show-fingers → say-word). The camera + recorder keep
             running underneath (Gemini needs the continuous video; detection is harmless — the
             gesture is latched), but the user sees only the big "Say N" text. z-index above the
             skeleton canvas (z4). Toggled from the per-frame block. -->
        <div id="vacSayView" style="display:none;position:absolute;inset:0;z-index:7;background:var(--bg,#0A0F1A);flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:18px;gap:10px;">
            <div style="font-size:clamp(13px,3.6vw,15px);color:var(--text-tertiary);font-family:var(--mono);letter-spacing:1.5px;">SAY IT OUT LOUD</div>
            <div id="vacSayWord" style="font-size:clamp(40px,14vw,72px);font-weight:800;color:#fbbf24;line-height:1;"></div>
            <div style="font-size:clamp(13px,3.6vw,15px);color:var(--text-secondary);">Just say the number — we're listening</div>
            <div id="vacSayEq" class="vac-eq" style="display:flex;justify-content:center;align-items:flex-end;gap:5px;height:36px;margin-top:6px;"><span></span><span></span><span></span><span></span><span></span></div>
            <div id="vacSayLevelTrack" style="width:min(240px,70%);height:8px;border-radius:4px;background:rgba(255,255,255,.14);margin-top:10px;position:relative;overflow:visible;">
                <div id="vacSayLevelFill" style="height:100%;width:0%;background:#8b97ad;border-radius:4px;transition:width 60ms linear;"></div>
                <div style="position:absolute;top:-3px;bottom:-3px;width:2px;background:#fbbf24;left:40%;border-radius:1px;"></div>
            </div>
            <div style="font-size:11px;color:#8b97ad;margin-top:4px;">speak so the bar passes the line</div>
            <div id="vacSayHint" style="font-size:12px;color:var(--text-tertiary);min-height:1.2em;"></div>
        </div>
    </div>
    <!-- S111 finding #3: instruction text moved OUT of the camera overlay — it was behind the
         z-index:4 hand-skeleton canvas (unreadable at the moment it's needed). Now a readable
         panel BELOW the feed; the numbers live in #digitStrip ABOVE (single source, de-duped). -->
    <div id="challengePanel" class="challenge-panel">
        <div class="camera-challenge-text" id="challengeText">Loading challenge…</div>
        <!-- F-563 (2): live audio equaliser — STABLE element (not rewritten by renderGreeting's
             per-tick innerHTML), driven each frame off the mic level the system is already analysing.
             DISPLAY-ONLY: proves "we hear you / mic working", never feeds the gate. -->
        <div id="vacEqGreeting" class="vac-eq" style="display:none;justify-content:center;align-items:flex-end;gap:4px;height:30px;margin-top:8px;"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="camera-challenge-sub">Look at the camera the whole time</div>
    </div>
    <div class="timer-label" id="timerLabel">Recording in</div>
    <div class="countdown-ring-wrap" id="countdownRingWrap">
        <svg viewBox="0 0 100 100">
            <circle class="ring-bg" cx="50" cy="50" r="39"/>
            <circle class="ring-fill" cx="50" cy="50" r="39" id="countdownRingFill" style="stroke-dasharray: 245; stroke-dashoffset: 0;"/>
        </svg>
        <div class="countdown-number" id="countdownTimer">3</div>
    </div>
    <!-- Combined capture explanation (visible during recording) -->
    <div id="combinedCaptureInfo" style="margin-top: 8px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px;">
        <div style="font-family: var(--mono); font-size: 10px; color: var(--teal); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;">How it works</div>
        <div id="combinedCaptureText" style="font-size: clamp(11px, 3vw, 13px); color: var(--text-secondary); line-height: 1.5;">
            Say the greeting, then show each number as you say it. Wait for the ✓ before moving to the next. One continuous take, 6 signals verified by AI.
        </div>
    </div>
</div>

<!-- F-563 (1): UPFRONT EXPLAINER — big-text screen shown before the challenge starts, so the
     guided per-digit gates feel expected. Previews the full sequence ONCE (familiarity); the
     challenge itself still reveals one digit at a time. Overlay on top of step 2 (camera already
     warming behind it). Auto-proceed (service auto-retry) skips this. -->
<div id="challengeIntro" style="display:none;position:fixed;inset:0;z-index:200;background:var(--bg,#0A0F1A);padding:24px 20px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
  <div style="max-width:520px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;justify-content:center;text-align:center;gap:clamp(16px,3vh,28px);">
    <div>
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--teal);text-transform:uppercase;margin-bottom:10px;">Before we start</div>
      <div id="challengeIntroHeadline" style="font-size:clamp(22px,6vw,30px);font-weight:800;line-height:1.25;color:var(--text-primary);">First a greeting,<br>then your numbers.</div>
    </div>
    <div id="challengeIntroBody" style="font-size:clamp(15px,4vw,18px);line-height:1.5;color:var(--text-secondary);">
      <strong style="color:var(--text-primary);">First</strong>, you'll say a <strong style="color:var(--text-primary);">short greeting</strong> to confirm it's you.<br>
      <strong style="color:var(--text-primary);">Then</strong>, on the next step, we'll show you <strong style="color:var(--text-primary);"><span id="challengeIntroCount">3 numbers</span></strong> <strong style="color:var(--text-primary);">one at a time</strong> — for each, <strong style="color:var(--text-primary);">show that many fingers AND say it together</strong>.<br>
      No need to memorise them — we'll guide you through each one with a <span style="color:#22c55e;font-weight:700;">✓</span> before the next.
    </div>
    <div id="challengeIntroPreview" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:clamp(14px,3vh,20px);">
      <!-- D-INTRO-GREETING-NUMBERS-ASYMMETRY (S114): preview the GREETING too, not just the numbers.
           Sourced from vacGreetingText() in showChallengeIntro — the SAME rotating greeting + real
           name the greeting screen shows. -->
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:1.5px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:8px;">You'll say</div>
      <div id="challengeIntroGreeting" style="font-size:clamp(16px,4.4vw,20px);font-weight:700;color:var(--text-primary);line-height:1.3;margin-bottom:16px;">&ldquo;&rdquo;</div>
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:1.5px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:12px;">then show each AND say it — at the same time</div>
      <div id="challengeIntroDigits" style="display:flex;justify-content:center;gap:clamp(10px,3vw,16px);flex-wrap:wrap;"></div>
      <div style="font-size:13px;color:var(--text-tertiary);margin-top:12px;">No need to memorise — we'll guide you through each one.</div>
    </div>
    <button id="challengeIntroBtn" onclick="dismissChallengeIntro()" class="btn-primary" style="font-size:clamp(15px,4vw,17px);padding:16px 24px;width:100%;max-width:340px;margin:0 auto;">I'm ready — start</button>
  </div>
</div>

<!-- STEP 3: Processing — REAL verification -->
<div class="step-section" id="step3">
    <div class="header">
        <button onclick="VACReauth.toCamera()" class="btn-back" aria-label="Back to Camera" id="verifyBackBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
            Start over
        </button>
        <div class="header-eyebrow">Step 4 of 4</div>
        <div class="header-title" id="verifyStepTitle">Verifying You're Human</div>
        <div class="header-sub" id="verifySubtitle">Sending biometric data to verification engines…</div>
    </div>
    <div class="progress-container">
        <div class="progress-ring">
            <svg viewBox="0 0 80 80" style="width:64px;height:64px">
                <circle class="ring-bg" cx="40" cy="40" r="36"/>
                <circle class="ring-fill" cx="40" cy="40" r="36" id="progressRing"/>
            </svg>
        </div>
        <div class="progress-step" id="progressStep">Uploading recording…</div>
        <div class="progress-detail" id="progressDetail">Video + Audio → Gemini + Deepgram</div>
    </div>
    <div class="modality-results" id="modalityResults">
        <div class="modality-toggle" id="modalityToggle" onclick="toggleModalities()">
            <span class="toggle-label">Verification Modalities</span>
            <span class="toggle-summary" id="modalitySummary">Checking…</span>
            <span class="toggle-arrow">▼</span>
        </div>
        <div class="modality-list" id="modalityList">
        <div class="mod-result" id="modFace" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Face Liveness</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Confirms a real person is present, not a photo or mask</span></div>
        <div class="mod-result" id="modDidit" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Face Liveness (Didit)</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Independent passive-liveness check (Didit provider) on a bound still frame from the recording.</span></div>
        <div class="mod-result" id="modDeepfake" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Deepfake Detection</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Checks for AI-generated or manipulated video artifacts</span></div>
        <div class="mod-result" id="modVoice" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Speech Match</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Confirms the challenge phrase was spoken clearly</span></div>
        <div class="mod-result" id="modLipSync" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Lip-Sync</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Confirms lip movements match spoken audio in real time</span></div>
        <div class="mod-result" id="modChallenge" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Challenge Response</span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Matches spoken words against a unique server-generated phrase</span></div>
        <div class="mod-result" id="modFinger" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Finger Gesture <span class="mod-gating-tag">Required · deny on mismatch</span></span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Verifies the correct finger count is shown near the face. A wrong count DENIES the verdict (deny-only — it can fail you but never passes you on its own; the other modalities do the accepting).</span></div>
        <div class="mod-subhead">Advisory signals <span class="mod-subhead-note">— informational, did not affect the verdict</span></div>
        <div class="mod-result advisory" id="modDuress" onclick="toggleModRow(this)"><span class="mod-status">⏳</span><span class="mod-name">Duress Detection <span class="mod-advisory-tag">Advisory · deny-signal</span></span><span class="mod-caret" aria-hidden="true">▸</span><span class="mod-score pending">—</span><span class="mod-desc">Checks for signs of coercion — unusual eye movement, forced expression, visible tension. A deny-signal (silent alarm if detected), not a pass/fail gate.</span></div>
        </div>
    </div>
    <!-- Under the Hood — engine analysis details -->
    <div class="modality-results" id="underHoodContainer" style="display:none;margin-top: clamp(8px, 1vh, 12px);">
        <div class="modality-toggle" onclick="toggleUnderHood()">
            <span class="toggle-label">Under the Hood</span>
            <span class="toggle-summary" id="hoodSummary" style="color: var(--text-tertiary);">Gemini + Deepgram</span>
            <span class="toggle-arrow" id="hoodArrow">▼</span>
        </div>
        <div class="modality-list" id="underHoodList">
            <div id="hoodContent" style="padding: clamp(8px, 1vh, 12px) 0; font-size: clamp(11px, 1.2vw, 12px); font-family: var(--mono); color: var(--text-secondary); line-height: 1.6;">
                <div style="color: var(--text-quaternary); margin-bottom: 6px;">Loading engine data…</div>
            </div>
        </div>
    </div>

    <div id="retrySection" style="display:none; margin-top: 20px;">
        <div id="failReasonCard" style="background: var(--error-bg); border: 1px solid var(--error-border); border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">
            <div style="font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--error); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px;">Why it failed</div>
            <div id="failReasons" style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;"></div>
        </div>
        <div id="retryTips" style="background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">
            <div style="font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--teal); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px;">Try this</div>
            <div id="retryTipsList" style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;"></div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button class="btn-primary" onclick="retryVerification()" style="flex: 1;">Retry Verification</button>
            <button class="btn-secondary" onclick="VACReauth.continueAnyway()" id="btnContinueAnyway" style="flex: 0 0 auto; display: none;">Continue Anyway</button>
        </div>
        <div style="font-family: var(--mono); font-size: 11px; color: var(--text-quaternary); text-align: center; margin-top: 8px;" id="retryCount"></div>
    </div>
</div>`;
const CEREMONY_CSS = `/* ─── Theme defaults (overridden by vac-themes.js at runtime) ─── */
:root {
    --bg: #0D1117;
    --surface: #161B22;
    --surface-raised: #1C2128;
    --border: #30363D;
    --border-light: #3D444D;
    --text-primary: #F0F6FC;
    --text-secondary: #C9D1D9;
    --text-tertiary: #8B949E;
    --text-quaternary: #6E7681;
    --purple: #6C5CE7;
    --purple-dim: #5A4BD1;
    --purple-bg: rgba(108,92,231,0.08);
    --purple-border: rgba(108,92,231,0.25);
    --teal: #00CEC9;
    --teal-bg: rgba(0,206,201,0.08);
    --teal-border: rgba(0,206,201,0.2);
    --success: #3FB950;
    --success-bg: rgba(63,185,80,0.08);
    --success-border: rgba(63,185,80,0.2);
    --error: #F85149;
    --error-bg: rgba(248,81,73,0.08);
    --error-border: rgba(248,81,73,0.2);
    --warning: #D29922;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); color: var(--text-secondary); background: var(--bg); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; min-height: 100dvh; }

.page { max-width: 560px; margin: 0 auto; padding: 0 clamp(12px, 4vw, 20px) 40px; }

/* Nav */
.nav { border-bottom: 1px solid var(--border); padding: 0 20px; background: rgba(13,17,23,0.95); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 100; }
.nav-inner { max-width: 560px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; height: 52px; }
.nav-left { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.nav-icon { width: 22px; height: 22px; }
.nav-wordmark { font-weight: 700; font-size: 13px; color: var(--text-primary); letter-spacing: 1.5px; }
.nav-wordmark span { font-weight: 400; color: var(--text-tertiary); letter-spacing: 1px; }
.nav-mode { font-family: var(--mono); font-size: 10px; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px; font-weight: 600; color: var(--purple); background: var(--purple-bg); border: 1px solid var(--purple-border); }

/* Step indicators */
.steps-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 20px 0 8px; }
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); transition: all 0.3s; }
.step-dot.active { background: var(--purple); box-shadow: 0 0 8px rgba(108,92,231,0.4); }
.step-dot.done { background: var(--success); }
.step-line { width: 24px; height: 1.5px; background: var(--border); transition: background 0.3s; }
.step-line.done { background: var(--success); }

/* Sections */
.step-section { display: none; animation: fadeIn 0.35s ease-out; }
.step-section.active { display: block; }
/* F-758: scroll affordance — fade + chevron shown only when content overflows below the fold */
#vacScrollCue { position: fixed; left: 0; right: 0; bottom: 0; height: 64px; pointer-events: none; z-index: 250; display: none; background: linear-gradient(to top, var(--bg,#0A0F1A) 10%, rgba(10,15,26,0) 100%); }
#vacScrollCue.show { display: block; }
#vacScrollCue .chev { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); width: 26px; height: 26px; color: var(--purple); animation: vacScrollBob 1.4s ease-in-out infinite; }
@keyframes vacScrollBob { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(5px); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.header { text-align: center; padding: clamp(4px, 1vh, 12px) 0 clamp(4px, 1vh, 10px); position: relative; }
.header-eyebrow { font-family: var(--mono); font-size: clamp(9px, 2.5vw, 11px); color: var(--teal); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
.header-title { font-size: clamp(18px, 5vw, 24px); font-weight: 700; color: var(--text-primary); line-height: 1.3; }
.header-sub { font-size: clamp(11px, 3vw, 13px); color: var(--text-tertiary); margin-top: 4px; max-width: 400px; margin-left: auto; margin-right: auto; line-height: 1.4; }

/* Forms */
.form-group { margin-bottom: 16px; }
.form-label { font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; display: block; }
.form-input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; font-family: var(--font); font-size: 15px; color: var(--text-primary); outline: none; transition: border-color 0.15s; }
.form-input:focus { border-color: var(--purple); }
.form-input::placeholder { color: var(--text-quaternary); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* Buttons */
.btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--purple); color: #fff; font-family: var(--font); font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: var(--radius); border: none; cursor: pointer; transition: all 0.15s; letter-spacing: 0.3px; width: 100%; min-height: 48px; }
.btn-primary:hover { background: var(--purple-dim); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(108,92,231,0.25); }
.btn-primary:disabled { opacity: 0.4; cursor: default; transform: none; box-shadow: none; background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary); }
.btn-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--surface); color: var(--text-primary); font-family: var(--font); font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer; transition: all 0.15s; min-height: 44px; }
.btn-secondary:hover { border-color: var(--purple); background: var(--purple-bg); }

/* Camera */
/* D-VERIFY-CHECKS-BELOW-FOLD / F-758: cap the feed tighter so the whole pre-flight
   (header + feed + mic + checks + Start button) fits one ~800px laptop viewport
   without scrolling. Was 36vh/300px which still pushed Start below the fold. */
.camera-container { position: relative; width: 100%; aspect-ratio: 4/3; max-height: clamp(150px, 28vh, 250px); background: #000; border-radius: 12px; overflow: hidden; border: 2px solid var(--border); margin-bottom: clamp(4px, 0.8vh, 8px); }
.camera-container.recording { border-color: var(--error); box-shadow: 0 0 20px rgba(248,81,73,0.15); max-height: clamp(220px, 42vh, 400px); }
.camera-container.verified { border-color: var(--success); box-shadow: 0 0 20px rgba(63,185,80,0.15); }
#videoPreview, #videoPreviewRec { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); display: block; background: #000; }

/* Face oval guide */
.face-oval { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: clamp(120px, 35vw, 180px); height: clamp(160px, 45vw, 240px); pointer-events: none; }
.face-oval-ring { fill: none; stroke: var(--purple); stroke-width: 2; stroke-dasharray: 8 4; opacity: 0.6; transition: all 0.3s; }
.camera-container.face-detected .face-oval-ring { stroke: var(--success); stroke-dasharray: none; opacity: 0.8; }
.face-oval-label { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-family: var(--mono); font-size: 9px; color: var(--text-tertiary); letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; background: rgba(0,0,0,0.7); padding: 2px 8px; border-radius: 3px; }
/* F-755d: .hand-zone container — label only. Stale pre-S139 centre-oval SVG removed.
   Drawn guide lives on canvas (avHandOverlay / handOverlay, z-index:4) from GESTURE_ZONE_SPEC.
   z-index:3 keeps container below the canvas so the live drawn guide is unobscured. */
.hand-zone { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 64%; height: 80%; pointer-events: none; display: none; z-index: 3; }
.camera-container.show-hand-zone .hand-zone { display: block; }
/* Lane A two-zone: face oval remains visible alongside the hand guide during the gesture
   step so the user places face AND hand in their respective zones simultaneously.
   The purple face oval (inner) + teal hand oval (outer) form the two-zone guide. */
.camera-container.show-hand-zone .face-oval { display: block; opacity: 0.7; }
.hand-zone-ring { fill: none; stroke: var(--teal, #00cec9); stroke-width: 2.5; stroke-dasharray: 10 6; opacity: 0.55; transition: all 0.3s; }
.camera-container.hand-in-zone .hand-zone-ring { stroke: var(--success); opacity: 0.9; }
.hand-zone-label { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-family: var(--mono); font-size: 9px; color: var(--text-tertiary); letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; background: rgba(0,0,0,0.7); padding: 2px 8px; border-radius: 3px; transition: color 0.3s; }
/* F-760: hide the persistent 'HOLD HAND BESIDE YOUR CHEEK' label on the CAPTURE box — the instruction
   is already at the top of the screen, and it overlapped the live readout. In-video space is for
   real-time feedback only (framing prompt + fingers/mic readout). */
#cameraBoxRec .hand-zone-label { display: none !important; }
.camera-container.hand-in-zone .hand-zone-label { color: var(--success); }

/* Countdown ring */
.countdown-ring-wrap { width: clamp(72px, 18vw, 100px); height: clamp(72px, 18vw, 100px); margin: 4px auto; position: relative; }
.countdown-ring-wrap svg { transform: rotate(-90deg); width: 100%; height: 100%; }
.countdown-ring-wrap .ring-bg { fill: none; stroke: var(--border); stroke-width: 3; }
.countdown-ring-wrap .ring-fill { fill: none; stroke: var(--purple); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 245; stroke-dashoffset: 0; transition: stroke-dashoffset 1s linear; }
.countdown-ring-wrap .ring-fill.recording { stroke: var(--error); }
.countdown-number { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--mono); font-size: clamp(24px, 6vw, 32px); font-weight: 700; color: var(--text-primary); }

/* Privacy statement */
.privacy-statement { display: flex; align-items: flex-start; gap: 6px; padding: clamp(4px, 0.8vh, 8px) clamp(6px, 1vw, 10px); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: clamp(6px, 1vh, 14px); font-size: clamp(10px, 1.2vw, 12px); color: var(--text-tertiary); line-height: 1.4; }
.privacy-statement svg { flex-shrink: 0; margin-top: 1px; }

/* Scroll indicator */
.scroll-hint { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 90; opacity: 0.7; transition: opacity 0.3s; pointer-events: none; }
.scroll-hint.hidden { opacity: 0; }
.scroll-hint svg { animation: bounce-down 1.5s ease-in-out infinite; }
@keyframes bounce-down { 0%,100% { transform: translateY(0); } 50% { transform: translateY(5px); } }

/* Audio level indicator */
.audio-level { position: absolute; top: 8px; right: 8px; display: flex; align-items: flex-end; gap: 2px; height: 20px; background: rgba(0,0,0,0.7); padding: 3px 5px; border-radius: 4px; }
.audio-bar { width: 3px; background: var(--success); border-radius: 1px; transition: height 0.08s ease-out; min-height: 2px; }
/* F-563 (2): live audio equaliser bars (display-only; driven off the mic level the gate analyses) */
.vac-eq > span { display: inline-block; width: 6px; height: 4px; border-radius: 3px; background: var(--text-quaternary, #6E7681); transition: height 0.1s ease, background 0.1s ease; }
.camera-overlay { position: absolute; inset: 0; pointer-events: none; }
.camera-corners { position: absolute; inset: 8px; }
.camera-corners::before, .camera-corners::after { content: ''; position: absolute; width: 20px; height: 20px; border-color: var(--purple); border-style: solid; }
.camera-corners::before { top: 0; left: 0; border-width: 2px 0 0 2px; border-radius: 4px 0 0 0; }
.camera-corners::after { top: 0; right: 0; border-width: 2px 2px 0 0; border-radius: 0 4px 0 0; }
.camera-corners-bottom { position: absolute; inset: 8px; }
.camera-corners-bottom::before, .camera-corners-bottom::after { content: ''; position: absolute; width: 20px; height: 20px; border-color: var(--purple); border-style: solid; }
.camera-corners-bottom::before { bottom: 0; left: 0; border-width: 0 0 2px 2px; border-radius: 0 0 0 4px; }
.camera-corners-bottom::after { bottom: 0; right: 0; border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; }
.camera-label { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); font-family: var(--mono); font-size: 9px; color: var(--teal); letter-spacing: 1.5px; text-transform: uppercase; background: rgba(0,0,0,0.7); padding: 3px 10px; border-radius: 4px; }
.rec-indicator { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 4px; font-family: var(--mono); font-size: 10px; color: var(--error); letter-spacing: 1px; background: rgba(0,0,0,0.7); padding: 3px 8px; border-radius: 4px; }
.rec-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--error); animation: pulse-rec 1s ease-in-out infinite; }
@keyframes pulse-rec { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes pulse { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(124,92,252,0.4); } 50% { transform: scale(1.08); box-shadow: 0 0 20px 4px rgba(124,92,252,0.3); } }
/* S111 #3: instruction text is now a readable panel BELOW the feed (was an absolutely-
   positioned overlay inside the video, behind the z-index:4 skeleton canvas → unreadable). */
.challenge-panel { margin: 10px 0 0; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; text-align: center; }
.camera-challenge-text { font-size: clamp(13px, 3.5vw, 16px); font-weight: 600; color: var(--text-primary); line-height: 1.3; }
.camera-challenge-sub { font-size: clamp(10px, 2.5vw, 12px); color: var(--text-tertiary); margin-top: 2px; }

/* Progress */
.progress-container { text-align: center; padding: 16px 0; }
.progress-ring { width: 64px; height: 64px; margin: 0 auto 10px; position: relative; }
.progress-ring svg { transform: rotate(-90deg); }
.progress-ring circle { fill: none; stroke-width: 3; }
.progress-ring .ring-bg { stroke: var(--border); }
.progress-ring .ring-fill { stroke: var(--purple); stroke-dasharray: 226; stroke-dashoffset: 226; transition: stroke-dashoffset 0.3s; stroke-linecap: round; }
.progress-step { font-family: var(--mono); font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.progress-detail { font-size: 14px; color: var(--text-secondary); }

/* Modality results — collapsible dropdown */
.modality-results { max-width: 360px; margin: clamp(8px, 1.5vh, 16px) auto 0; }
.modality-toggle { display: flex; align-items: center; justify-content: space-between; padding: clamp(6px, 1vh, 10px) clamp(10px, 2vw, 16px); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; user-select: none; transition: all 0.2s; }
.modality-toggle:hover { border-color: var(--accent); }
.modality-toggle .toggle-label { font-size: clamp(11px, 1.3vw, 13px); color: var(--text-secondary); font-weight: 500; }
.modality-toggle .toggle-summary { font-family: var(--mono); font-size: clamp(10px, 1.2vw, 12px); color: var(--success); }
.modality-toggle .toggle-summary.has-fail { color: var(--error); }
.modality-toggle .toggle-arrow { font-size: 10px; color: var(--text-tertiary); transition: transform 0.2s; }
.modality-toggle.open .toggle-arrow { transform: rotate(180deg); }
.modality-list { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.modality-list.open { max-height: 800px; }
.mod-result { display: flex; align-items: center; gap: clamp(6px, 1vw, 10px); padding: clamp(4px, 0.6vh, 6px) 0; font-size: clamp(11px, 1.3vw, 13px); }
.mod-result + .mod-result { border-top: 1px solid var(--border); }
.mod-status { width: 18px; text-align: center; font-size: 13px; }
.mod-name { flex: 1; color: var(--text-secondary); }
.mod-score { font-family: var(--mono); font-size: clamp(10px, 1.2vw, 12px); font-weight: 600; }
.mod-score.pass { color: var(--success); }
.mod-score.fail { color: var(--error); }
.mod-score.pending { color: var(--text-quaternary); }
.mod-result { flex-wrap: wrap; }
/* F-AUTH-UX-POLISH (1): disclosure caret — the whole .mod-result row is the hit area
   (cursor:pointer below), the caret is the visual "click to expand" cue. ▸ → ▾ via a
   90° rotation on the row's \`.open\` class — same caret glyph + rotate style as the
   "Learn what this enables ▸" / "How we authenticated you" disclosures elsewhere on
   the page, so the affordance reads consistently. The 32×32 min box preserves the old
   .mod-info tap target (keeps the row >= 32px tall). */
.mod-result { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mod-caret { font-size: 11px; color: var(--text-tertiary); min-width: 32px; min-height: 32px; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, color 0.2s; flex-shrink: 0; }
.mod-result:hover .mod-caret, .mod-result:active .mod-caret { color: var(--accent); }
.mod-desc { display: none; width: 100%; font-size: clamp(9px, 1.1vw, 11px); color: var(--text-quaternary); padding: 2px 0 4px 28px; line-height: 1.4; }
.mod-detail-expand { display: none; }
/* A single \`.open\` class on the row drives ALL of it in sync — caret rotation, the static
   .mod-desc, and the dynamic engine .mod-detail-expand — so whichever detail exists shows
   together and the caret always reflects the row's true open/closed state. */
.mod-result.open .mod-desc { display: block; }
.mod-result.open .mod-detail-expand { display: block; }
.mod-result.open .mod-caret { transform: rotate(90deg); color: var(--accent); }

/* UI HONESTY (S117 / D-F577-D3-FALSE-ACCEPT): ADVISORY modalities (Finger Gesture, Duress) are
   NEVER consulted in compute_honest_verdict — finger has a known false-accept and can't gate yet;
   duress is a deny-signal, not a pass/fail gate. They must NOT look like the mandatory pass/fail
   rows. The subheading + muted dot + chip make clear they're informational and didn't gate the
   verdict. Presentation only — no score, verdict, or modality-requirement change. */
.mod-subhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; width: 100%; font-size: clamp(9px, 1.1vw, 11px); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--text-tertiary); padding: clamp(8px, 1.2vh, 12px) 0 4px; margin-top: clamp(4px, 0.8vh, 8px); border-top: 1px solid var(--border); }
.mod-subhead-note { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--text-quaternary); }
.mod-advisory-tag { display: inline-block; font-family: var(--mono); font-size: clamp(8px, 1vw, 10px); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; white-space: nowrap; }
.mod-gating-tag { display: inline-block; font-family: var(--mono); font-size: clamp(8px, 1vw, 10px); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--teal, #00cec9); background: rgba(0,206,201,0.10); border: 1px solid rgba(0,206,201,0.35); border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; white-space: nowrap; }
.mod-score.advisory { color: var(--text-tertiary); font-weight: 500; }

/* Back button */
.btn-back { position: relative; display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--text-secondary); font-family: var(--mono); font-size: 12px; cursor: pointer; padding: 8px 4px; transition: color 0.2s; margin-bottom: 4px; }
.btn-back:hover { color: var(--text-primary); }
.btn-back svg { opacity: 0.6; }

/* Success chain display */
.chain-result { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 10px; }

/* AV check pills */
.av-pill { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 10px; flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; font-size: clamp(11px, 1.2vw, 12px); color: var(--text-secondary); transition: border-color 0.3s, background 0.3s; }
.av-pill.good { border-color: var(--success); background: rgba(63,185,80,0.08); color: var(--success); }
.av-pill.warn { border-color: var(--warning); background: rgba(210,153,34,0.08); color: var(--warning); }
.av-pill.bad { border-color: var(--error); background: rgba(248,81,73,0.08); color: var(--error); }
.av-pill-icon { width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; }
.av-pill-icon svg { width: 14px; height: 14px; }
.av-pill-value { font-family: var(--mono); font-size: 10px; opacity: 0.7; }
@keyframes av-spin { to { transform: rotate(360deg); } }
.av-pill-icon.spinning svg { animation: av-spin 1s linear infinite; }

/* Under the Hood engine detail */
.hood-section { margin-bottom: clamp(6px, 1vh, 10px); }
.hood-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent); margin-bottom: 3px; }
.hood-value { color: var(--text-primary); word-break: break-word; }
.hood-provider { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 4px; background: rgba(139,92,246,0.15); color: var(--accent); margin-left: 6px; }
.chain-node-result { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
.chain-node-result + .chain-node-result { border-top: 1px solid var(--border); }
.chain-depth { font-family: var(--mono); font-size: 10px; color: var(--text-quaternary); width: 16px; text-align: center; }
.chain-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.chain-icon.human { background: var(--teal-bg); border: 1px solid var(--teal-border); }
.chain-icon.agent { background: var(--purple-bg); border: 1px solid var(--purple-border); }
.chain-info { flex: 1; min-width: 0; }
.chain-agent-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.chain-scope { font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); }
.chain-trust { font-family: var(--mono); font-size: 12px; font-weight: 600; }
.chain-trust.high { color: var(--success); }
.chain-trust.mid { color: var(--warning); }
.chain-arrow { text-align: center; color: var(--text-quaternary); font-size: 11px; padding: 2px 0; }

/* Share section */
.share-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 10px; }
.share-url { font-family: var(--mono); font-size: 12px; color: var(--teal); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; word-break: break-all; margin: 12px 0; cursor: pointer; transition: border-color 0.15s; }
.share-url:hover { border-color: var(--teal-border); }

/* Patent badge */
.patent-badge { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 6px 14px; margin-top: 16px; }
.patent-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--purple); }

/* Modality list */
.modalities-mini { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.modalities-mini.open { max-height: 600px !important; opacity: 1 !important; }
.dd-arrow.open { transform: rotate(180deg); }
.mod-chip { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 11px; color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); border-radius: 4px; padding: 3px 8px; }
.mod-chip .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--success); }
.mod-chip.failed { color: var(--error); background: var(--error-bg); border-color: var(--error-border); }
.mod-chip.failed .dot { background: var(--error); }
.mod-chip.optional { opacity: 0.45; }
.mod-chip.optional .dot { background: var(--text-quaternary); }
.mod-chip.recommended { opacity: 0.7; border-style: dashed; }
.adaptive-auth-bar { text-align: center; margin-bottom: 8px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.5px; padding: 6px 12px; border-radius: 6px; }
.adaptive-auth-bar.streamlined { color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); }
.adaptive-auth-bar.standard { color: var(--purple); background: var(--purple-bg); border: 1px solid var(--purple-border); }

/* Timer */
.timer-display { font-family: var(--mono); font-size: 36px; font-weight: 700; color: var(--text-primary); text-align: center; margin: 8px 0; }
.timer-label { font-family: var(--mono); font-size: 11px; color: var(--text-tertiary); text-align: center; letter-spacing: 1px; text-transform: uppercase; margin-top: 12px; margin-bottom: 8px; }

/* Footer tagline */
.footer-tagline { text-align: center; padding: 24px 0; font-size: 13px; font-style: italic; color: var(--text-quaternary); border-top: 1px solid var(--border); margin-top: 24px; }

/* Error */
.error-msg { font-size: 13px; color: var(--error); text-align: center; margin-top: 12px; font-family: var(--mono); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Claim mapping pills */
.claim-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.claim-pill { font-family: var(--mono); font-size: 10px; color: var(--text-quaternary); background: var(--bg); border: 1px solid var(--border); border-radius: 3px; padding: 2px 6px; }
.claim-pill.active { color: var(--purple); border-color: var(--purple-border); background: var(--purple-bg); }

/* Transcript display */
.transcript-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-top: 12px; }
.transcript-label { font-family: var(--mono); font-size: 10px; color: var(--text-quaternary); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
.transcript-text { font-size: 14px; color: var(--text-primary); font-style: italic; }
.transcript-match { font-family: var(--mono); font-size: 11px; margin-top: 6px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}`;

function injectStyles(){
    if (document.getElementById('vac-reauth-styles')) return;
    var s = document.createElement('style');
    s.id = 'vac-reauth-styles';
    s.textContent = CEREMONY_CSS;
    document.head.appendChild(s);
}
function renderDOM(){
    injectStyles();
    CTX.mount.innerHTML = CEREMONY_HTML;   // fresh DOM each run (matches the reload "fresh start" discipline)
    // F-763d (DIAGNOSTIC): visible confirmation that QA mode is active — plain DOM, not canvas, so it
    // can't be cleared/mirrored. If Rob sees "QA ON" the flag works (readout issue is canvas-side);
    // if not, the ?qa=1 flag isn't flipping. Remove once the readout is confirmed working.
    try {
        if (QA && QA.on && !document.getElementById('vacQaBadge')) {
            var _qb = document.createElement('div');
            _qb.id = 'vacQaBadge';
            _qb.textContent = 'QA ON';
            _qb.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;background:#F4D03F;color:#000;font-family:monospace;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;';
            document.body.appendChild(_qb);
        }
    } catch(_) {}
    // F-758: scroll affordance — show a fade+chevron when the pre-flight overflows below the fold,
    // hide once the user scrolls near the bottom. Standard "there's more below" cue.
    try {
        if (!document.getElementById('vacScrollCue')) {
            var _cue = document.createElement('div');
            _cue.id = 'vacScrollCue';
            _cue.innerHTML = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
            document.body.appendChild(_cue);
        }
        var _scEl = CTX.mount;
        var _scScroller = null;
        // find the nearest scrollable ancestor (the mount or a parent with overflow)
        (function(){ var n = CTX.mount; while (n && n !== document.body) { var oy = getComputedStyle(n).overflowY; if (oy === 'auto' || oy === 'scroll') { _scScroller = n; break; } n = n.parentElement; } })();
        var _updateCue = function(){
            try {
                var cue = document.getElementById('vacScrollCue'); if (!cue) return;
                var s = _scScroller || document.scrollingElement || document.documentElement;
                var overflow = s.scrollHeight - s.clientHeight;
                var atBottom = (s.scrollTop >= overflow - 24);
                if (overflow > 24 && !atBottom) cue.classList.add('show'); else cue.classList.remove('show');
            } catch(_) {}
        };
        (_scScroller || window).addEventListener('scroll', _updateCue, { passive: true });
        window.addEventListener('resize', _updateCue, { passive: true });
        setTimeout(_updateCue, 300); setTimeout(_updateCue, 900);
        CTX._updateScrollCue = _updateCue;  // callers can re-check after step changes
    } catch(_) {}
}

// ===================== public API =====================
const VACReauth = {
    // run({email,name,riskLevel,mount,context,onComplete,onFallback,onRequireFull,onReauthReload,onBack,onStep,auto,org,role,profile})
    //   profile: optional COPS/PID actuator { num_digits?, required_modalities?, thresholds? }.
    //   Only num_digits is live (→ challenge POST); omit profile entirely for prod-default behaviour.
    run: function(opts){
        opts = opts || {};
        CTX = {
            identity: { name: opts.name||'', email: opts.email||'', org: opts.org||'', role: opts.role||'' },
            riskLevel: opts.riskLevel || 'medium',
            mount: (typeof opts.mount === 'string') ? document.getElementById(opts.mount) : opts.mount,
            context: opts.context || 'register',
            onComplete: opts.onComplete || function(){},
            onFallback: opts.onFallback || function(){},
            onRequireFull: opts.onRequireFull || null,
            onReauthReload: opts.onReauthReload || null,
            onBack: opts.onBack || null,
            onStep: opts.onStep || null,
            auto: !!opts.auto,
            // COPS/PID policy actuator. Today only num_digits is read (→ challenge POST); the
            // object is stored whole so required_modalities + thresholds can be wired later
            // without changing run()'s signature. Omitted → null → server decides everything.
            profile: opts.profile || null,
        };
        if (!CTX.mount) { console.error('[VACReauth] run() called with no mount element'); return; }
        // S120 live-test fix: fast mode → fast countdown timing (1s) so the still-capture
        // quick check isn't paced like the full relaxed ceremony. Full/omitted → unchanged.
        if (CTX.profile && CTX.profile.mode === 'fast') { challengeSpeed = 'fast'; }
        // F-635 (greeting as a composable COPS/PID axis): profile.greeting === 'skip' drops the
        // greeting/voice-anchor phase from a FULL ceremony — for a same-session re-auth where the
        // greeting was already collected, the second auth is visibly lighter (digits + face only).
        // Omitted → 'required' (regression guard: auth.html and the FIRST full auth are unchanged).
        // Backend-coherent: the full verify gates on the OTP digit match + face embedding + liveness,
        // NOT on the greeting words (greeting is the voice-anchor, not the challenge-response gate).
        skipGreeting = !!(CTX.profile && CTX.profile.greeting === 'skip');
        // F-635 + fast mode: BOTH are greeting-less (fast = the fast-direct-path still capture;
        // greeting:skip = a full ceremony minus the greeting). Either way the static step-2 copy
        // must not tell the user to "say a greeting" — update the header subtitle + how-it-works
        if (typeof opts.retryAttempts === 'number') retryAttempts = opts.retryAttempts;   // seed retry budget on a resumed retry
        try { if (window.QA && !(QA && QA.on)) QA = window.QA; } catch(_) {}   // adopt host overlay unless ?qa=1 already self-enabled (F-763c)
        renderDOM();
        // F-687 Fix 4: context-derived verification heading. Re-auth contexts read "Confirming it's
        // still you"; auth.html's first/main auth (context:'register') keeps "Verifying You're Human".
        try { var _vst = document.getElementById('verifyStepTitle'); if (_vst && _isReauthContext()) _vst.textContent = "Confirming it's still you"; } catch(_) {}
        // F-635-LIGHTER (ordering fix): rewrite the greeting-less copy AFTER renderDOM() — the prior
        // build ran this BEFORE renderDOM, so step2HeaderSub/combinedCaptureText didn't exist yet
        // (getElementById → null) and the static "Say a greeting" default rendered unchanged.
        // F-654 STEP 2: the greeting-less COPY decision should ALSO be a policy output, not only
        // the skipGreeting/mode shadow flags. run() executes before the challenge fetch, so the live
        // reauth_modality_policy isn't on challengeData yet here; but a host/profile MAY carry the
        // policy's required modalities up-front (CTX.profile.required_modalities) — when it does and
        // lists no voice modality, treat the run as greeting-less. Regression guard preserved: this is
        // an ADDITIONAL trigger ORed in; absent any such hint the behaviour is exactly as before
        // (skipGreeting / still mode only). The authoritative timing skip still derives from the live
        // server policy in beginRecording (PHRASE_DURATION=0); this only keeps the header copy honest.
        var _policyDropsVoiceHint = false;
        try {
            var _rm = CTX.profile && CTX.profile.required_modalities;
            if (Array.isArray(_rm) && _rm.length) {
                _policyDropsVoiceHint = !_rm.some(function(m){ return /voice|voiceprint/i.test(String(m)); });
            }
        } catch(_) {}
        var _greetingless = skipGreeting || (modeConfig().capture.kind === 'still') || _policyDropsVoiceHint;
        if (_greetingless) {
            try {
                var _hs = document.getElementById('step2HeaderSub');
                var _cct = document.getElementById('combinedCaptureText');
                if (skipGreeting) {
                    // F-648: name-less seal re-auth — say the NUMBERS only (the per-session anti-replay
                    // anchor); no name, no greeting. Backend phrase is digits-only (scorer core = digits).
                    if (_hs) _hs.textContent = 'Say your numbers, showing each on your fingers beside your cheek. Wait for the ✓.';
                    if (_cct) _cct.textContent = 'Say your numbers out loud, then show each on your fingers beside your cheek as you say it — one take. No name or greeting needed; you verified moments ago.';
                } else if (modeConfig().capture.kind === 'still') {
                    // fast still-capture (vat-verify): genuinely one number, no phrase. F-687 Fix 1: re-verify framing.
                    // F-755i: 'beside your cheek' — consistent with the full-flow pre-flight copy.
                    if (_hs) _hs.textContent = 'Quick re-verify — show the number beside your cheek and say it out loud. Wait for the ✓.';
                    if (_cct) _cct.textContent = 'Quick re-verify — show the number beside your cheek and say it out loud. A quick face + number check (shown and spoken together); you verified moments ago, so no greeting is needed.';
                } else {
                    // Non-still greeting-less (e.g. policy-drops-voice on a full re-auth).
                    // F-755i: 'beside your cheek' — consistent with the full-flow pre-flight copy.
                    if (_hs) _hs.textContent = 'Show the number beside your cheek and say it out loud. Wait for the ✓.';
                    if (_cct) _cct.textContent = 'Show the number beside your cheek — a quick face + number check. You verified moments ago, so no greeting is needed.';
                }
            } catch(_) {}
        }
        CTX.mount.style.display = 'block';
        try { if (window.FingerDetector && !window.FingerDetector.ready) setTimeout(window.FingerDetector.init, 0); } catch(_) {}
        goToStep(1);                                  // show the camera pre-flight (step 1)
        try { vacDebug('reauth_run', null, { risk: CTX.riskLevel, context: CTX.context, auto: CTX.auto }); } catch(_) {}
        if (CTX.auto) { try { requestCamera(); } catch(_) {} }   // resume / service-error auto path
    },
    // back-button (step 2/3) → return to the camera pre-flight
    toCamera: function(){ goToStep(1); },
    // back-button (step 1) → cancel the ceremony, return control to the host
    cancel: function(){ try { if (CTX && CTX.mount) CTX.mount.style.display='none'; } catch(_){} if (CTX && CTX.onBack){ try { CTX.onBack(); } catch(_){} } },
    // "Continue Anyway" (after MAX_RETRIES) → host decides what a partial result means (auth.html
    // routes it through showSuccess(), which renders the honest partial screen + emits no verified side-effects)
    continueAnyway: function(){ _finish(); },
    // retry / no-mic recovery → host restart mechanism (auth.html = full page reload + resume blob;
    // STEP 2/3: vat-verify + tribunal re-invoke run() in place instead)
    reload: function(o){ if (CTX && CTX.onReauthReload){ try { CTX.onReauthReload(o||{}); } catch(_){} } else { console.warn('[VACReauth] reload() with no onReauthReload host handler'); } },
};
window.VACReauth = VACReauth;

// S157 C1: full device teardown on page unload.
// pagehide fires on all browsers; beforeunload as belt-and-suspenders for desktop.
// iOS BFCache: pagehide fires with persisted=true when the page enters the back/forward cache
// (NOT a real unload) — skip teardown so the page restores correctly.
(function() {
    function _teardownOnExit(ev) {
        if (ev.type === 'pagehide' && ev.persisted) return;
        try { stopAudioMonitor(); } catch(_) {}
        try {
            if (mediaStream) {
                mediaStream.getTracks().forEach(function(t) { try { t.stop(); } catch(_) {} });
            }
        } catch(_) {}
    }
    window.addEventListener('pagehide', _teardownOnExit, { passive: true });
    window.addEventListener('beforeunload', _teardownOnExit);
})();

// The extracted DOM uses inline onclick="fn()" for these ceremony handlers — expose them globally
// so those attributes resolve (they were page globals in auth.html; behaviour preserved).
window.requestCamera = requestCamera;
window.retryAVSetup = retryAVSetup;
window.dismissChallengeIntro = dismissChallengeIntro;
window.toggleModalities = toggleModalities;
window.toggleModRow = toggleModRow;
window.toggleUnderHood = toggleUnderHood;
window.retryVerification = retryVerification;
window.setFingerFallback = setFingerFallback;
window._dismissNoMic = _dismissNoMic;

})();
