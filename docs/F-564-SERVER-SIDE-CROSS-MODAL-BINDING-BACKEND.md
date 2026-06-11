# F-564 — Server-side cross-modal binding + strict challenge-match (vac-system BACKEND)

> **HIGH PRIORITY / security-critical.** Created S111, 11 Jun 2026 from a vac-web live pass.
> **This is a vac-system (Railway) backend change, NOT auth-test.html.** The auth-test.html
> on-device fixes (#1 digit VAD, #4 say-digits-up-front) shipped on
> `Schemo512/f561-multimodal-advance-gate`; they harden the *pacing*, not the server-side check.
>
> **Honest framing — do not overclaim in the meantime:** the SUPP-7 per-digit cross-modal
> binding ("each spoken number bound to its gesture") is currently a **UX construct enforced
> ONLY on-device**, NOT a verified server-side property. The authoritative backend does not
> bind spoken digits to gestures and accepts partial digits. Until F-564 lands, do not claim
> the cross-modal binding as a verified security property.

## Evidence (from the live pass + engine.py, whose set-overlap matches live behaviour)
A passing run showed **Challenge Match 80%**, heard "Hi there. I'm Rob Zagarella. 3 5" vs
expected "…3 5 2" — **2 of 3 digits, and it PASSED.** Tracing the backend:

- **Challenge-response = a whole-transcript SET overlap** (`engine.py` ~610–632):
  `normalize_words()` builds a `set()` of all spoken words+digits; `match_ratio =
  len(expected_core ∩ transcript_core) / len(expected_core)`; `matches = match_ratio >=
  CHALLENGE_WORD_MATCH_THRESHOLD`. **Order-independent, partial-credit**, digits pooled with
  greeting words. Expected `{rob,zagarella,3,5,2}` vs heard `{rob,zagarella,3,5}` → **0.80**,
  which clears the threshold.
- **Gestures and voice are SEPARATE modalities** combined by a weighted sum
  (`compute_trust_score`: `video 0.30 + voice 0.20 + finger 0.20 + otp 0.15 + geo 0.15`,
  pass at `total >= 0.70`). **Nothing binds spoken-digit-N to gesture-N.** Voice is only 0.20,
  so a weak/partial voice is carried by the other modalities.
- The backend also **lacks the data** to bind them: the frontend sends only the whole
  video+audio recording + `client_detected_counts` (no per-digit voice timestamps aligned to
  per-gesture video).

## #2 — Strict challenge-match (require ALL digits, ideally in order)
The set-overlap + `CHALLENGE_WORD_MATCH_THRESHOLD (<=0.80)` lets 2-of-3 digits pass.
**Fix:** require **every** expected digit present (not a percentage), and ideally **in the
expected order** (the current set comparison is order-blind). Separate the digit-match from
the greeting-word match so missing a digit fails the challenge regardless of greeting overlap.

## #3 — Enforce the per-digit cross-modal binding server-side (THE security fix)
Make the authoritative check actually verify "spoken digit N occurred during gesture N":
1. **Frontend (auth-test.html) must SEND per-digit voice timing** aligned to per-gesture video
   — e.g. for each digit i: the gesture window `[t_gesture_start, t_gesture_end]` and the
   spoken-onset time(s). (The client already computes the per-digit speech onset — `_markSpeech`
   `onset_perf` — and the gesture confirm times; surface them in the verify payload.) This is a
   companion frontend change, tracked here so they land together.
2. **Backend** verifies, per position i: the digit spoken within/near gesture i's window equals
   the gesture's count (Gemini's `digits_seen[i]`), and ALL i pass. Reject if any digit is
   missing, out of order, or not co-located with its gesture.
3. Until (1)+(2) exist, the binding is on-device pacing only — Gemini's independent
   gesture-vision + lenient phrase-overlap is the real gate.

## Where
- **vac-system** (Railway `vac-system-production`): the deployed verify endpoint
  (`/v1/vat/auth/verify`) + the engine scoring (`engine.py` here is a STALE local copy whose
  logic matches deployed behaviour — edit the real vac-system source, not this copy).
- **vac-web** companion: extend the `/verify` payload with per-digit voice/gesture timing.

## Related / not this ticket
- Backend Gemini latency ("Analysing biometrics" slow) = **F-558** (separate).
- No-adjacent-repeat digit constraint, stale `engine.py` cleanup = existing vac-system TODOs.
