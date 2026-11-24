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
  // Diagnostics only: the probe that explains a no_face refusal. Never a gate.
  var DIAG_PROBE_CONFIDENCE = 0.05;
  var DIAG_PROBE_BUDGET_MS = 1200;
  // S207 calibrated multi-face rule (Rob, 24 Nov: a mirror behind him refused a
  // real approval). The client cannot tell a reflection from a real person, so it
  // does not try: it picks the primary face and tolerates SMALLER SECONDARY FACES
  // (REFLECTIONS OR BYSTANDERS) only for choosing the descriptor, and always reports
  // them (ignoredFaces). All four must hold, else 'multiple_faces':
  //   - the largest face is confidently a face (score >= PRIMARY_MIN_SCORE);
  //   - its centre is in the middle of the frame (the oval the user is framed in);
  //   - every other face is a smaller secondary face: area <= EXTRA_MAX_AREA_RATIO x
  //     the primary's, or low-confidence (< EXTRA_LOW_SCORE) AND area <= EXTRA_LOW_MAX_AREA_RATIO;
  //   - at most MAX_EXTRA_FACES secondary faces.
  // This is NOT a pass: the server counts faces itself and refuses the full ceremony
  // unless it sees exactly one, and gives no tolerance band when ignoredFaces > 0.
  // The descriptor is ALWAYS the primary face's.
  var PRIMARY_MIN_SCORE = 0.8;
  var PRIMARY_CENTRE_BAND = 0.2;        // centre must be within [0.2, 0.8] of width and height
  var EXTRA_MAX_AREA_RATIO = 0.25;
  var EXTRA_LOW_SCORE = 0.6;
  var EXTRA_LOW_MAX_AREA_RATIO = 0.5;
  var MAX_EXTRA_FACES = 2;

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
        // WARM-UP (S204, 4 Nov): loading only downloads weights. The FIRST
        // inference also uploads them to the GPU and compiles every shader,
        // which on a cold WebGL context can take longer than the ceremony's
        // first-capture budget (measured ~10 s vs ~1.7 s warm). Run each of
        // the three nets once on a blank frame here, during the pre-flight,
        // so the real capture runs warm. Output is discarded; no descriptor,
        // threshold or identity decision is involved. Errors are ignored
        // (the real compute() still fails closed on its own).
        try {
          var _wc = document.createElement('canvas');
          _wc.width = 160; _wc.height = 160;
          var _wx = _wc.getContext('2d'); _wx.fillStyle = '#808080'; _wx.fillRect(0, 0, 160, 160);
          var _tw = performance.now();
          await faceapi.detectAllFaces(_wc, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECT_CONFIDENCE }));
          await faceapi.detectFaceLandmarks(_wc);
          await faceapi.computeFaceDescriptor(_wc);
          console.log('[VACFaceEmbed] warm-up inference ' + Math.round(performance.now() - _tw) + 'ms');
        } catch (_) {}
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

  // Pure: picks the one face to use from N>1 detections, or null (refuse).
  // faces: [{score, box:{x,y,width,height}}]; frameW/frameH: input pixel size.
  // Returns {index, ignored} or null. No I/O, so it is unit-tested directly.
  function selectPrimaryFace(faces, frameW, frameH) {
    if (!faces || faces.length < 2) return null;
    if (!(frameW > 0) || !(frameH > 0)) return null;
    if (faces.length - 1 > MAX_EXTRA_FACES) return null;
    var areas = [];
    for (var i = 0; i < faces.length; i++) {
      var f = faces[i], b = f && f.box;
      if (!b || !(b.width > 0) || !(b.height > 0) || typeof f.score !== 'number' || !isFinite(f.score)) return null;
      areas.push(b.width * b.height);
    }
    var p = 0;
    for (var j = 1; j < faces.length; j++) if (areas[j] > areas[p]) p = j;
    var pf = faces[p];
    if (pf.score < PRIMARY_MIN_SCORE) return null;
    var cx = (pf.box.x + pf.box.width / 2) / frameW;
    var cy = (pf.box.y + pf.box.height / 2) / frameH;
    if (cx < PRIMARY_CENTRE_BAND || cx > 1 - PRIMARY_CENTRE_BAND ||
        cy < PRIMARY_CENTRE_BAND || cy > 1 - PRIMARY_CENTRE_BAND) return null;
    for (var k = 0; k < faces.length; k++) {
      if (k === p) continue;
      var ratio = areas[k] / areas[p];
      var smallerSecondary = ratio <= EXTRA_MAX_AREA_RATIO ||
                  (faces[k].score < EXTRA_LOW_SCORE && ratio <= EXTRA_LOW_MAX_AREA_RATIO);
      if (!smallerSecondary) return null;
    }
    return { index: p, ignored: faces.length - 1 };
  }

  // Pure: everything compute() does AFTER detection (n >= 1), so it is unit-tested
  // with fake face-api results. results: [{detection:{score, box}, descriptor}].
  // The descriptor is ALWAYS results[chosen].descriptor, the primary face's.
  function descriptorFromDetections(results, input) {
    var n = results ? results.length : 0;
    if (n === 0) return { ok: false, faceCount: 0, reason: 'no_face' };
    var chosen = 0, ignored = 0;
    if (n > 1) {
      var fw = (input && (input.videoWidth || input.naturalWidth || input.width)) || 0;
      var fh = (input && (input.videoHeight || input.naturalHeight || input.height)) || 0;
      var dets = results.map(function (r) {
        var d = r && r.detection;
        return (d && d.box) ? { score: d.score, box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height } } : null;
      });
      var sel = selectPrimaryFace(dets, fw, fh);
      if (!sel) return { ok: false, faceCount: n, reason: 'multiple_faces' };
      chosen = sel.index; ignored = sel.ignored;
    }
    var desc = results[chosen] && results[chosen].descriptor;
    if (!desc || desc.length !== EXPECTED_DIM) {
      return { ok: false, faceCount: n, reason: 'embedder_error' };
    }
    var arr = new Array(EXPECTED_DIM);
    for (var i = 0; i < EXPECTED_DIM; i++) {
      var v = Number(desc[i]);
      if (!isFinite(v)) return { ok: false, faceCount: n, reason: 'embedder_error' };
      arr[i] = v;
    }
    if (ignored > 0) {
      console.log('[VACFaceEmbed] ' + ignored + ' smaller secondary face(s) (reflections or bystanders) ignored for the descriptor; using the primary face; reported to the server');
      return { ok: true, embedding: arr, faceCount: n, ignoredFaces: ignored, warnings: ['extra_faces_ignored'] };
    }
    return { ok: true, embedding: arr, faceCount: 1, ignoredFaces: 0 };
  }

  // Compute a single-face 128-D descriptor from input (video/canvas/image).
  // Returns one of:
  //   {ok:true,  embedding:[128 floats], faceCount:1}
  //   {ok:true,  embedding:[...], faceCount:N, ignoredFaces:N-1, warnings:['extra_faces_ignored']}
  //       (one dominant, centred face plus smaller secondary faces (reflections or
  //        bystanders), see selectPrimaryFace)
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
      if (n === 0) {
        // DIAGNOSTIC ONLY (S204, 4 Nov): the decision above is final and
        // unchanged (MIN_DETECT_CONFIDENCE still gates). To explain the refusal
        // on screen, report the best face score a low-threshold probe can see in
        // the same frame. Never used to accept a face or build a descriptor.
        var best = null;
        try {
          // Bounded: on a slow device the probe must never turn a no_face
          // refusal into an engine timeout. No answer in time -> score unknown.
          var probe = await Promise.race([
            _faceapi.detectAllFaces(input, new _faceapi.SsdMobilenetv1Options({ minConfidence: DIAG_PROBE_CONFIDENCE })),
            new Promise(function (res) { setTimeout(function () { res(null); }, DIAG_PROBE_BUDGET_MS); })
          ]);
          for (var k = 0; probe && k < probe.length; k++) {
            var sc = probe[k] && probe[k].score;
            if (typeof sc === 'number' && isFinite(sc) && (best === null || sc > best)) best = sc;
          }
        } catch (_) {}
        return { ok: false, faceCount: 0, reason: 'no_face',
                 diag: { best_score: best, min_confidence: MIN_DETECT_CONFIDENCE } };
      }
      return descriptorFromDetections(results, input);
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
    selectPrimaryFace: selectPrimaryFace,
    descriptorFromDetections: descriptorFromDetections,
    euclidean: euclidean,
    reasonMessage: reasonMessage,
    MODEL_ID: MODEL_ID,
    MIN_DETECT_CONFIDENCE: MIN_DETECT_CONFIDENCE,
    VERSION: VERSION,
    EXPECTED_DIM: EXPECTED_DIM,
  };
})(typeof window !== 'undefined' ? window : this);
