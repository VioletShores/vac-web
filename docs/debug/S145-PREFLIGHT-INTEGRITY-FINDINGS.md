# S145 restaurant test — preflight integrity findings (Rob live, iPhone Safari, noisy restaurant, ~20:48 Vienna 23 Jul)
Evidence: S145-restaurant-preflight-phantom-evidence.png (screenshot, one frame carrying findings 1+2+4)

1. PHANTOM HAND + FALSE-READY HAND PILL (security-significant, recurrence of the D-series false-ready chip):
   skeleton landmarks rendered ON ROB'S FACE (no hand raised); readout: ZONE: OUT, wrist(0.59,0.70) = face region.
   Yet the Hand pill shows ✓ and the page says "All set — you're ready to verify".
   → The Hand-ready state is latching on phantom MediaPipe detections and is NOT gated on zone acceptance or detection stability.
2. MIC PILL LATCHES "working ✓" UNTESTED: shows ✓ at (2%) in a NOISY restaurant — ambient crossed the absolute
   >12%x3-frame bar (F-755f) at some point and the ✓ stuck. "Working" must mean "the USER's speech was heard during
   the speak-now prompt, clear of the ambient baseline" — relative-to-floor, prompt-windowed, and it should be able to regress.
3. SKELETON JITTER: phantom detections flicker frame to frame ("jittering all over the place") — draw needs a
   stability/confidence gate (N consecutive frames, min confidence, plausible geometry) before rendering at all.
4. RIGHT HAND NOT DRAWN when raised — detector appears locked on the phantom (single-detection selection?) or a
   handedness/selection issue; real hand loses to the hallucination.
Environment note: restaurant noise + restaurant lighting = the adversarial preflight case; quiet-hotel passes were
necessary but insufficient. Both environments now in the test matrix.

## Environmental correlation (Rob, hotel re-test ~21:45): skeleton jitter ABSENT in the quiet hotel room
Confirms the phantom driver is VISUAL scene complexity, not audio: restaurant = cluttered background, other
diners' real hands, warm dim light (face-shadows read as finger edges); hotel = plain wall, even light. The
restaurant attacked both channels at once — audio noise → mic-pill false ✓ (finding 2), visual noise → phantom
skeleton (findings 1/3/4). Quiet-room absence is NOT evidence of fixed. TEST MATRIX now three axes: quiet/plain ·
noisy-audio · BUSY-VISUAL scene (the deployment reality: cafés, offices, tribunal waiting rooms). Task 329's
stability/confidence/plausibility gating must be verified against a busy-visual scene, not just the hotel wall.

## Finding 5 (Rob e2e, ~22:25): QUICK-AUTH single-digit flow has NO mic bar
The fast credential-view ceremony (one spoken digit) runs a speech gate on a code path that never calls
_micPillDraw and apparently isn't covered by the always-on monitor drive. Locate that flow's VAD/say gate in
vac-reauth-ceremony.js, set __vacGateArmed + call _micPillDraw(rms, activeThr, tag 'q') there — same instrument,
every speaking surface (F-922 tier lock-step: a tier WITH a voice check must SHOW the voice instrument).
