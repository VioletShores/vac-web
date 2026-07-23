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
