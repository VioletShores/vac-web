/**
 * VAC Face Embedding — client-side face IDENTITY descriptor for re-auth
 * =====================================================================
 * Computes a real 128-D face-recognition embedding (face-api.js
 * `faceRecognitionNet`, FaceNet-style) from a video/canvas/image frame, with
 * SINGLE-FACE enforcement. Shared by the enrollment page (auth.html) AND the
 * re-auth SDK (vac-auth.js) so enrollment and re-auth
 * descriptors come from the IDENTICAL model + preprocessing — distances are only
 * comparable that way.
 *
 * Why face-api.js and not the already-loaded MediaPipe FaceLandmarker: MediaPipe
 * returns 478 geometric landmarks (face SHAPE), not an identity embedding — it
 * cannot tell look-alikes apart. faceRecognitionNet returns a 128-D identity
 * vector (LFW 99.38% @ euclidean 0.6). That is the whole point of this feature.
 *
 * TRUST BOUNDARY: this only COMPUTES and returns the vector. The IDENTITY
 * decision (distance vs threshold) is made SERVER-SIDE in /v1/auth/face-reauth.
 * The single-face / "no POST" checks here are UX + a first gate; they are NOT the
 * security boundary (an attacker can call the API directly — the server fails
 * closed on a missing/invalid embedding when one is enrolled).
 *
 * FAIL-CLOSED: any load/detector/parse error returns {ok:false}. Callers must
 * treat !ok as a hard stop (reject / require retry), never as a pass.
 *
 * Pinned to an EXACT version (no @latest) so descriptors + threshold stay stable.
 * Supply-chain note: served from cdn.jsdelivr.net (same posture as the existing
 * MediaPipe load). Self-hosting + SRI is a recommended follow-up for the
 * certified-vendor lane.
 *
 * © 2026 Violet Shores Pty Ltd — vacprotocol.org
 */
(function (global) {
  'use strict';

  var VERSION = '1.7.15';
  var LIB_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
  var MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
  // Provenance string stored alongside the embedding (must match the backend's value).
  var MODEL_ID = '@vladmandic/face-api@1.7.15:faceRecognitionNet';
  var EXPECTED_DIM = 128;
  var MIN_DETECT_CONFIDENCE = 0.5;

  var _faceapi = null;
  var _ready = false;
  var _failed = false;
  var _loading = null;

  // Load the library (dynamic import of the ESM build — works from a classic
  // script) + the 3 model sets. Idempotent; concurrent callers share one promise.
  function _load() {
    if (_ready) return Promise.resolve(true);
    if (_failed) return Promise.resolve(false);
    if (_loading) return _loading;
    _loading = (async function () {
      var t0 = (global.performance && performance.now) ? performance.now() : 0;
      try {
        var faceapi = await import(LIB_URL);
        // Ensure a working TFJS backend. Real browsers use WebGL (fast). On some
        // headless / locked-down browsers there's no GPU backend and wasm can fail to
        // init — fall back to the always-available CPU backend so the embedder still
        // works (slower). Only fail-closed if even CPU can't come up.
        try { await faceapi.tf.ready(); } catch (_) {}
        var backend = faceapi.tf.getBackend && faceapi.tf.getBackend();
        if (backend !== 'webgl' && backend !== 'webgpu') {
          try { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); } catch (_) {}
        }
        console.log('[VACFaceEmbed] tfjs backend: ' + (faceapi.tf.getBackend && faceapi.tf.getBackend()));
        // ssdMobilenetv1: robust multi-face detection (single-face enforcement).
        // faceLandmark68Net: aligns the face before the descriptor.
        // faceRecognitionNet: the 128-D identity descriptor.
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        _faceapi = faceapi;
        _ready = true;
        var dt = t0 ? Math.round(performance.now() - t0) : 0;
        console.log('[VACFaceEmbed] face-api ' + VERSION + ' + models ready (' + dt + 'ms)');
        return true;
      } catch (e) {
        _failed = true;
        console.warn('[VACFaceEmbed] load FAILED (fail-closed):', (e && e.message) || e);
        return false;
      }
    })();
    return _loading;
  }

  // Compute a single-face 128-D descriptor from input (video/canvas/image).
  // Returns one of:
  //   {ok:true,  embedding:[128 floats], faceCount:1}
  //   {ok:false, faceCount:0,  reason:'no_face'}
  //   {ok:false, faceCount:N,  reason:'multiple_faces'}
  //   {ok:false, faceCount:-1, reason:'embedder_error'}  (load/detector failure)
  async function compute(input) {
    var ok = await _load();
    if (!ok) return { ok: false, faceCount: -1, reason: 'embedder_error' };
    try {
      var opts = new _faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECT_CONFIDENCE });
      var results = await _faceapi.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors();
      var n = results ? results.length : 0;
      if (n === 0) return { ok: false, faceCount: 0, reason: 'no_face' };
      if (n > 1) return { ok: false, faceCount: n, reason: 'multiple_faces' };
      var desc = results[0].descriptor;
      if (!desc || desc.length !== EXPECTED_DIM) {
        return { ok: false, faceCount: 1, reason: 'embedder_error' };
      }
      var arr = new Array(EXPECTED_DIM);
      for (var i = 0; i < EXPECTED_DIM; i++) {
        var v = Number(desc[i]);
        if (!isFinite(v)) return { ok: false, faceCount: 1, reason: 'embedder_error' };
        arr[i] = v;
      }
      return { ok: true, embedding: arr, faceCount: 1 };
    } catch (e) {
      console.warn('[VACFaceEmbed] compute error (fail-closed):', (e && e.message) || e);
      return { ok: false, faceCount: -1, reason: 'embedder_error' };
    }
  }

  // Euclidean distance — for the local test harness only (the real decision is
  // server-side). Returns null on shape mismatch.
  function euclidean(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  function reasonMessage(reason) {
    if (reason === 'no_face') return 'No face detected — face the camera in good light.';
    if (reason === 'multiple_faces') return 'More than one face detected — one person only.';
    return 'Face check unavailable — please try again.';
  }

  global.VACFaceEmbed = {
    ready: _load,
    compute: compute,
    euclidean: euclidean,
    reasonMessage: reasonMessage,
    MODEL_ID: MODEL_ID,
    VERSION: VERSION,
    EXPECTED_DIM: EXPECTED_DIM,
  };
})(typeof window !== 'undefined' ? window : this);
