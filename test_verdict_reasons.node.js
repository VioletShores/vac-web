/*
 * Regression test — verdict-evidence coherence (task-515 P0-2, ported from
 * vac-protocol vac-frontend/test_verdict_reasons.node.js).
 *
 * Guards the exact failure mode found in the old showRetry(): the displayed
 * "why did this fail" reason must name a signal that appears in the
 * attempt's actual evidence, i.e. result.verdict.reasons (compute_honest_
 * verdict's own output) — never a generic, signal-less message when the
 * verdict has a real reason on record, and never a modality that is a
 * bystander to the real cause.
 *
 * Run: node test_verdict_reasons.node.js
 */
const assert = require('assert');
const { deriveFailureDisplay, reasonSignal } = require('./verdict-reasons.js');

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failures++;
        console.error(`FAIL - ${name}`);
        console.error(`  ${e.message}`);
    }
}

// A duress-only deny: every modality's own status is "verified"/"clear" —
// the duress modality itself reports status "alert", never "failed"/"error".
// This is the exact case the old status-filtered showRetry() missed
// entirely, falling back to a signal-less generic message.
function duressOnlyDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['duress:high(likelihood=0.75,under_duress=True,status=alert)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'lip_sync', status: 'verified', score: 0.7, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
                { name: 'deepfake_detection', status: 'verified', score: 0.95, detail: {} },
                { name: 'finger_gesture', status: 'verified', score: 0.85, detail: {} },
                { name: 'duress', status: 'alert', score: 0.25, detail: {} },
            ],
        },
    };
}

// A deepfake deny where Gemini's own is_likely_real bool disagreed with the
// deepfake_likelihood float the verdict actually gates on — modality.status
// stayed "verified" while the verdict denied on "deepfake:positive(...)".
function deepfakeLikelihoodDisagreementDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['deepfake:positive(likelihood=0.62)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'lip_sync', status: 'verified', score: 0.7, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
                // status stayed "verified" (is_likely_real=true) despite a
                // deepfake_likelihood that denies the verdict.
                { name: 'deepfake_detection', status: 'verified', score: 0.4, detail: {} },
                { name: 'finger_gesture', status: 'verified', score: 0.85, detail: {} },
            ],
        },
    };
}

// The Gemini deepfake scan itself errored out (service down, not an actual
// deepfake finding) — compute_honest_verdict still blocks on an incomplete
// scan ("deepfake:scan_not_clean_present"), but the modality's own status is
// "error". Regression guard for the reason-prefix ("deepfake") vs modality
// name ("deepfake_detection") mismatch: findMod() must still resolve this to
// the real modality so the error branch fires, not the alarming
// "indicators detected" default text.
function deepfakeServiceErrorDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['deepfake:scan_not_clean_present(status=error,provider=gemini)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'lip_sync', status: 'verified', score: 0.7, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
                { name: 'deepfake_detection', status: 'error', score: 0, detail: {} },
                { name: 'finger_gesture', status: 'verified', score: 0.85, detail: {} },
            ],
        },
    };
}

// Gemini returned no finger count at all; the client-side (forgeable) MediaPipe
// count matched the expected sequence, so digits_seen (client fallback) equals
// digits_expected — engine.py still soft-fails this (a pass may never come from
// the client alone). The old "mismatch — expected [x] but Gemini saw [x]" text
// would be self-contradictory here.
function fingerGeminiEmptyClientFallbackDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['finger_gesture:gemini_empty_client_unverified(provider=gemini+client_fallback)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
                {
                    name: 'finger_gesture', status: 'verified', score: 0.85,
                    detail: { digits_expected: [2, 1, 3], digits_seen: [2, 1, 3], sequence_source: 'gemini+client_fallback' },
                },
            ],
        },
    };
}

// A deepfake scan that ran but returned no usable likelihood — engine.py fails
// this closed as an INCOMPLETE scan, not a positive finding, and the modality
// can still read "verified" (Gemini said is_likely_real:true with no number).
function deepfakeLikelihoodMissingDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['deepfake:likelihood_missing(incomplete_scan)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
                { name: 'deepfake_detection', status: 'verified', score: 0.5, detail: {} },
                { name: 'finger_gesture', status: 'verified', score: 0.85, detail: {} },
            ],
        },
    };
}

function voiceprintBelowFloorWithUnrelatedErrorDenial() {
    return {
        authenticated: false,
        verdict: {
            authenticated: false,
            reasons: ['voiceprint:below_floor(0.3<0.5)'],
        },
        biometric_verification: {
            modalities: [
                { name: 'face_liveness', status: 'verified', score: 0.9, detail: {} },
                { name: 'voiceprint', status: 'verified', score: 0.3, detail: {} },
                // an unrelated bystander modality that DID flip to "error" —
                // must not be the reason shown, since it's not in verdict.reasons.
                { name: 'lip_sync', status: 'error', score: 0, detail: {} },
                { name: 'challenge_response', status: 'verified', score: 0.9, detail: {} },
            ],
        },
    };
}

test('duress-only denial names duress, not a generic message', () => {
    const { reasons } = deriveFailureDisplay(duressOnlyDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    // vac-web's own duress copy ("Duress check — monitoring for signs of
    // coercion.") differs in wording from vac-protocol's ("Unusual
    // behaviour...") — this only asserts the signal is named, not the exact
    // live-tuned phrasing.
    assert.ok(/duress/i.test(reasons[0]), `reason should name duress, got: "${reasons[0]}"`);
});

test('deepfake likelihood/status disagreement still names deepfake', () => {
    const { reasons } = deriveFailureDisplay(deepfakeLikelihoodDisagreementDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    assert.ok(/deepfake/i.test(reasons[0]), `reason should name deepfake, got: "${reasons[0]}"`);
});

test('reason names the signal in verdict.reasons, not an unrelated errored modality', () => {
    const { reasons } = deriveFailureDisplay(voiceprintBelowFloorWithUnrelatedErrorDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    assert.ok(/voice/i.test(reasons[0]), `reason should name voiceprint, got: "${reasons[0]}"`);
    assert.ok(!/lip/i.test(reasons[0]), `reason must not blame the unrelated lip_sync error, got: "${reasons[0]}"`);
});

test('finger gesture: Gemini-empty client-fallback names "could not verify", not a self-contradictory mismatch', () => {
    const { reasons } = deriveFailureDisplay(fingerGeminiEmptyClientFallbackDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    assert.ok(/could not verify/i.test(reasons[0]), `reason should explain Gemini didn't verify it, got: "${reasons[0]}"`);
    assert.ok(!/mismatch/i.test(reasons[0]), `must not claim a mismatch when digits_seen equals digits_expected, got: "${reasons[0]}"`);
});

test('deepfake likelihood_missing names an incomplete scan, not a positive deepfake finding', () => {
    const { reasons } = deriveFailureDisplay(deepfakeLikelihoodMissingDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    assert.ok(/could not be completed|incomplete/i.test(reasons[0]), `reason should describe an incomplete scan, got: "${reasons[0]}"`);
    assert.ok(!/indicators detected/i.test(reasons[0]), `must not falsely accuse the user of a detected deepfake, got: "${reasons[0]}"`);
});

test('deepfake service error names "service unavailable", not a false deepfake alarm', () => {
    const { reasons, tips } = deriveFailureDisplay(deepfakeServiceErrorDenial());
    assert.strictEqual(reasons.length, 1, `expected exactly one reason, got: ${JSON.stringify(reasons)}`);
    assert.ok(/service unavailable/i.test(reasons[0]), `reason should report the outage, got: "${reasons[0]}"`);
    assert.ok(!/indicators detected/i.test(reasons[0]), `must not falsely alarm on a scan error, got: "${reasons[0]}"`);
    assert.strictEqual(tips.length, 0, `an outage must not carry a user-fault remediation tip, got: ${JSON.stringify(tips)}`);
});

test('fallback path (no verdict.reasons): all-errors-no-real-failures still reassures on voice/location', () => {
    const result = {
        authenticated: false,
        verdict: { authenticated: false, reasons: [] },
        biometric_verification: {
            modalities: [
                { name: 'voiceprint', status: 'verified', score: 0.8, detail: {} },
                { name: 'geolocation', status: 'verified', score: 1, detail: {} },
                { name: 'deepfake_detection', status: 'error', score: 0, detail: {} },
            ],
        },
    };
    const { reasons, tips } = deriveFailureDisplay(result);
    assert.strictEqual(reasons.length, 1, `expected one reason (the errored modality), got: ${JSON.stringify(reasons)}`);
    assert.ok(tips.some(t => /temporarily unavailable/i.test(t)), `expected the reassurance tip, got: ${JSON.stringify(tips)}`);
});

test('reasonSignal parses the modality prefix off a verdict reason code', () => {
    assert.strictEqual(reasonSignal('voiceprint:below_floor(0.3<0.5)'), 'voiceprint');
    assert.strictEqual(reasonSignal('duress:high(likelihood=0.75)'), 'duress');
    assert.strictEqual(reasonSignal('no_colon_code'), 'no_colon_code');
});

test('clean pass (empty verdict.reasons, no failed modalities) yields no reasons', () => {
    const result = {
        authenticated: true,
        verdict: { authenticated: true, reasons: [] },
        biometric_verification: { modalities: [{ name: 'face_liveness', status: 'verified', score: 0.9, detail: {} }] },
    };
    const { reasons } = deriveFailureDisplay(result);
    assert.strictEqual(reasons.length, 0);
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
} else {
    console.log('\nAll tests passed');
}
