/*
 * Verdict-evidence coherence (ported from vac-protocol task-515 P0-2,
 * commits b923dc3/6afc21c).
 *
 * Derives the human-readable "why did this fail" text shown on the auth
 * retry screen from `result.verdict.reasons` — compute_honest_verdict()'s
 * own authoritative list of what actually denied the request
 * (vac-backend/engine.py). This is deliberately NOT derived from each
 * modality's own `status` field: a modality can stay "verified"/"clear"/
 * "alert" while still being the exact signal the verdict denied on —
 * duress.status is "alert"/"clear" (never "failed"/"error"), and
 * deepfake_detection.status reflects Gemini's `is_likely_real` boolean,
 * which can disagree with the `deepfake_likelihood` float the verdict
 * actually gates on. Deriving the message from `status` alone can silently
 * drop the true reason and fall back to a signal-less generic message.
 *
 * FAIL_REASONS copy below is vac-web's own live-tuned product text (was
 * vac-reauth-ceremony.js's inline FAIL_REASONS), not vac-protocol's — only
 * the coherence-fixing derivation logic (reasonSignal/SIGNAL_TO_MODALITY/
 * deriveFailureDisplay) was ported; the wording is this lineage's, unchanged.
 *
 * Isomorphic: used as a plain <script> in auth.html (attaches
 * `window.VacVerdictReasons`) and via `require()` in the Node regression
 * test (test_verdict_reasons.node.js).
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.VacVerdictReasons = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Keyed by the verdict's reason-code prefix (compute_honest_verdict) OR a
    // modality name, whichever a given lookup uses — see reasonSignal().
    var FAIL_REASONS = {
        face_liveness: {
            reason: 'Face not detected or liveness check failed.',
            tip: 'Make sure your face is clearly visible, well-lit, and centered in the oval. Remove sunglasses or hats.'
        },
        deepfake_detection: {
            reason: 'Deepfake indicators detected in the video.',
            tip: 'Use your device camera directly — screen sharing, virtual cameras, or recorded playback will be rejected.'
        },
        voiceprint: {
            reason: 'Voice not captured clearly enough for analysis.',
            tip: 'Speak the challenge phrase clearly and at normal volume. Reduce background noise if possible.'
        },
        lip_sync: {
            reason: 'Lip movements did not match the spoken audio.',
            tip: 'Look directly at the camera while speaking. Make sure your mouth is visible and well-lit.'
        },
        challenge_response: {
            reason: 'Spoken words did not match the challenge phrase.',
            tip: 'Read the challenge phrase exactly as shown — include the greeting and all digits.'
        },
        duress: {
            reason: 'Duress check — monitoring for signs of coercion.',
            tip: 'This runs silently. If you are safe, this will always pass.'
        },
        finger_gesture: {
            reason: 'Finger count sequence did not match the expected digits.',
            tip: 'Show each digit with your fingers near your face. Change your hand clearly between each number — hold, change, hold. Keep fingers spread.'
        },
        geolocation: {
            reason: 'Location could not be determined.',
            tip: 'Allow location access when prompted by your browser.'
        },
        // verdict.reasons prefixes that do NOT match a modality name 1:1 — these
        // are the signals the old status-filtered logic dropped (task-515 P0-2).
        deepfake: {
            reason: 'Deepfake indicators detected in the video.',
            tip: 'Use your device camera directly — screen sharing, virtual cameras, or recorded playback will be rejected.'
        },
        identity_continuity: {
            reason: 'This capture did not match the identity already on file for this email.',
            tip: 'If this is you, use account recovery. If not, this account may be compromised — contact support.'
        },
        engine_crash: {
            reason: 'Verification service hit an unexpected error.',
            tip: 'Please try again — if this persists, contact support.'
        },
    };

    // "voiceprint:below_floor(0.3<0.5)" -> "voiceprint"
    function reasonSignal(code) {
        var i = code.indexOf(':');
        return i === -1 ? code : code.slice(0, i);
    }

    // verdict.reasons prefixes that don't match their modality's `name` field
    // 1:1 (the backend's modalities list names the Gemini deepfake scan
    // "deepfake_detection", but compute_honest_verdict's reason codes use the
    // "deepfake" prefix) — without this, findMod(signal) always misses and a
    // deepfake-service outage (status: 'error') gets displayed as a false
    // "deepfake detected" alarm instead of "service unavailable".
    var SIGNAL_TO_MODALITY = {
        deepfake: 'deepfake_detection'
    };

    // result: the JSON body from the verify endpoint —
    // { verdict: { reasons: [...] }, biometric_verification: { modalities: [...] } }
    // Returns { reasons: string[], tips: string[] } naming only signals that
    // are actually present in verdict.reasons (falls back to per-modality
    // status only when verdict.reasons is absent/empty — defensive, not the
    // primary path).
    function deriveFailureDisplay(result) {
        var bio = (result && result.biometric_verification) || {};
        var mods = bio.modalities || [];
        var verdictReasons = (result && result.verdict && result.verdict.reasons) || [];

        var reasons = [];
        var tips = [];

        function findMod(name) {
            for (var i = 0; i < mods.length; i++) {
                if (mods[i].name === name) return mods[i];
            }
            return null;
        }

        if (verdictReasons.length > 0) {
            var seen = {};
            for (var j = 0; j < verdictReasons.length; j++) {
                var code = verdictReasons[j];
                var signal = reasonSignal(code);
                if (seen[signal]) continue;
                seen[signal] = true;
                var mod = findMod(SIGNAL_TO_MODALITY[signal] || signal);
                // Outage, not user error — a remediation tip ("speak clearly", "use your
                // device camera") would wrongly tell the user to fix something on their
                // end when the service itself is down, so this path skips the tip push.
                var isServiceOutage = mod && mod.status === 'error';
                if (signal === 'challenge_response' && mod && mod.detail && (mod.detail.heard || mod.detail.expected)) {
                    reasons.push('Challenge Response — heard: "' + (mod.detail.heard || '(nothing)') + '" vs expected: "' + (mod.detail.expected || '') + '"');
                } else if (signal === 'finger_gesture' && code.indexOf('gemini_empty_client_unverified') !== -1) {
                    // Gemini returned no count at all — the on-device (forgeable) client
                    // count may have matched, but that alone can never pass (engine.py
                    // finger_softfail). digits_seen here holds the CLIENT fallback
                    // sequence, so it can equal digits_expected — showing that as a
                    // "mismatch" would be self-contradictory.
                    reasons.push('Gemini could not verify your finger sequence — please show your fingers clearly to the camera and repeat.');
                } else if (signal === 'finger_gesture' && mod && mod.detail) {
                    var exp = (mod.detail.digits_expected || []).join(', ');
                    var saw = (mod.detail.digits_seen || []).join(', ');
                    reasons.push('Finger gesture mismatch — expected [' + exp + '] but Gemini saw [' + saw + ']');
                } else if (signal === 'deepfake' && (code.indexOf('likelihood_missing') !== -1 || code.indexOf('likelihood_invalid') !== -1)) {
                    // Scan ran but didn't return a usable likelihood — fail-closed on an
                    // INCOMPLETE scan, not a positive deepfake finding. mod.status can
                    // still be "verified" here (e.g. is_likely_real:true with no
                    // likelihood field), so the generic FAIL_REASONS.deepfake alarm text
                    // ("indicators detected") would be a false accusation.
                    reasons.push('Deepfake scan could not be completed — video authenticity was not confirmed.');
                } else if (isServiceOutage) {
                    reasons.push(signal.replace(/_/g, ' ') + ' — service unavailable (will retry).');
                } else {
                    var info = FAIL_REASONS[signal] || { reason: signal.replace(/_/g, ' ') + ' check failed.', tip: '' };
                    reasons.push(info.reason);
                }
                if (!isServiceOutage) {
                    var tipInfo = FAIL_REASONS[signal];
                    if (tipInfo && tipInfo.tip) tips.push(tipInfo.tip);
                }
            }
        } else {
            var failed = mods.filter(function (m) { return m.status === 'failed' || m.status === 'error'; });
            reasons = failed.map(function (m) {
                if (m.status === 'error') return m.name.replace(/_/g, ' ') + ' — service unavailable (will retry).';
                if (m.name === 'challenge_response' && m.detail && (m.detail.heard || m.detail.expected)) {
                    return 'Challenge Response — heard: "' + (m.detail.heard || '(nothing)') + '" vs expected: "' + (m.detail.expected || '') + '"';
                }
                if (m.name === 'finger_gesture' && m.detail) {
                    var exp2 = (m.detail.digits_expected || []).join(', ');
                    var saw2 = (m.detail.digits_seen || []).join(', ');
                    return 'Finger gesture mismatch — expected [' + exp2 + '] but Gemini saw [' + saw2 + ']';
                }
                var info2 = FAIL_REASONS[m.name] || { reason: m.name + ' check failed.', tip: '' };
                return info2.reason;
            });
            tips = failed.filter(function (m) { return m.status === 'failed'; })
                .map(function (m) { return (FAIL_REASONS[m.name] || {}).tip; })
                .filter(Boolean);
            var hasRealFailures = failed.some(function (m) { return m.status === 'failed'; });
            if (failed.length > 0 && !hasRealFailures) {
                tips.push('Some verification services are temporarily unavailable. Your voice and location were verified successfully.');
            }
        }

        return { reasons: reasons, tips: tips };
    }

    return {
        FAIL_REASONS: FAIL_REASONS,
        reasonSignal: reasonSignal,
        deriveFailureDisplay: deriveFailureDisplay,
    };
}));
