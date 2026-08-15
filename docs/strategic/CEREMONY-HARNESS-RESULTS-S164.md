# Ceremony Gate Harness — Results (S164)

**Two test tiers — read this before citing either matrix:**

| Tier | File | Status | What it proves |
|------|------|--------|-----------------|
| Node mirror (fast) | `tests/ceremony-gate-harness.test.js` | **25/25 PASS — executed in this review, real output below** | The mirrored decision logic, anchored to source constants/text, behaves as expected against the fixtures. Does NOT by itself prove the shipped `_phraseVadTick`/`runAVFrame` behave this way — see design doc's L-511/L-676 discussion. |
| Playwright real-gate | `tests/ceremony-harness-fixtures.pw.js` | **NOT YET EXECUTED — CI-pending** (this sandbox has no root, cannot install headless Chromium's system libs) | Drives the actual unmodified gate functions via the F-1139 injection seam. This is the tier that closes the anti-trap gap. Check `.github/workflows/ceremony-harness-fixtures.yml`'s run status on this branch before treating it as confirmed. |

The matrices below are the **Node mirror tier's** output (the only tier with real executed evidence
as of this doc). Where the two tiers disagree once CI runs the Playwright tier, the Playwright tier
is authoritative — it runs the real code.

**Date:** 2026-08-16  
**Sprint:** S164  
**Refs:** F-1139, L-2503, L-2504, L-2505, VAC-PA-001 sec 12.2 (document not found in this repo checkout — see design doc)  
**Gate version:** S164 sustained-voiced-run (L-2503/L-2504 fix applied)

> **Methodological claim:** APCER/BPCER framing per ISO/IEC 30107-3 terminology.
> NOT an ISO-certified evaluation. Signals are synthetic; no real-person audio used.
> See F1139-HARNESS-DESIGN-S164.md for scope, constraints, and the VAC-PA-001 citation gap.

---

## PHRASE Gate Matrix (Greeting / Phrase Liveness) — Node mirror tier

Gate: `_phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED (7)` AND `mod >= PHRASE_MOD_DELTA (0.045)`

| Fixture | Category | RMS | vbRatio | Ticks | Mod | Outcome | Expected |
|---------|----------|-----|---------|-------|-----|---------|----------|
| `clean_greeting` | Bona-fide | 0.117/0.070 | 0.850 | 30 | 0.047 | **FIRES** | FIRES ✓ |
| `silence` | Reject | 0.000 | 0.000 | 0 | -1 | **STUCK** | STUCK ✓ |
| `single_tap` | Reject | 0.000 | 0.000 | 0 | -1 | **STUCK** | STUCK ✓ |
| `sustained_hum` | Reject | 0.094 | 0.000 | 0 | -1 | **STUCK** | STUCK ✓ |
| `background_tv` | Reject | 0.055 | 0.082 | 0 | -1 | **STUCK** | STUCK ✓ |
| `second_speaker` | APCER probe | 0.070 | 0.833 | 10 | 0.000 | **STUCK** | DOCUMENTS |
| `greeting_at_3m` | BPCER probe | 0.047 | 0.850 | 0 | -1 | **STUCK** | DOCUMENTS |
| **`IOS_AMPLITUDE_CRUSH`** | **Bug** | **0.031** | **0.850** | **0** | **-1** | **STUCK** | **BUG** |

### Notes

**`second_speaker` (APCER):**  
Ticks=10 with mod=0.000. The modulation gate (`phraseVoicedMax - phraseVoicedMin >= 0.045`) prevents a
flat-amplitude voiced signal from firing `phraseHeardVoice`. Second-person voice at constant RMS fails
the modulation check. This is a useful anti-replay property. If a second speaker alternates amplitude
naturally (as in `clean_greeting`), the client-side gate would fire — server-side content verification
(transcript match) remains the authoritative defense against second-speaker attacks.

**`greeting_at_3m` (BPCER):**  
RMS = 0.047 < `VAD_SPEECH_RMS_FALLBACK = 0.055`. User standing 3m away cannot accumulate voiced ticks.
Gate STUCK. BPCER risk at distance: legitimate users at 3m will be stuck. Hardware gain calibration or
a lower amplitude threshold could mitigate (fix lane decision).

**`IOS_AMPLITUDE_CRUSH` (BUG REPRODUCED):**  
See root-cause section below. This is the S164 priority bug.

---

## MIC-QUALIFY Gate Matrix (Preflight Mic Pill) — Node mirror tier

Gate: Path A = `avVbSustain >= 25` (voice-band EMA sustained rise); Path B = `_micLoudFrames >= 3` with seed window protection.

| Fixture | Category | RMS | vbRatio | avVbSustain | micLoud | Outcome | Expected |
|---------|----------|-----|---------|------------|---------|---------|----------|
| `clean_greeting` | Bona-fide | 0.117 | 0.850 | ≥25 | ✓ | **GREENS** | GREENS ✓ |
| `silence` | Reject | 0.000 | 0.000 | 0 | 0 | **RED** | RED ✓ |
| `single_tap` | Reject | 0.125 (1 frame) | — | 0 | <3 | **RED** | RED ✓ |
| `sustained_hum` | APCER probe | 0.094 | 0.000 | varies | — | **DOCUMENTS** | DOCUMENTS |
| `IOS_AMPLITUDE_CRUSH` | Bug probe | 0.031 | 0.850 | — | — | **DOCUMENTS** | DOCUMENTS |

### Notes

**`sustained_hum` mic-qualify:**  
Hum (bin 0, outside voice band 1-16) produces vbRatio ≈ 0, so Path A (`avVbSustain`) never
increments. Path B (`_micLoudFrames`) can accumulate if amplitude exceeds the seeded ambient
level — behavior depends on seed window timing (a DOCUMENTS result, not a hard STUCK assertion).

**`IOS_AMPLITUDE_CRUSH` mic-qualify:**  
At RMS=0.031, amplitude is above the seeded ambient floor (ambient typically near 0 in a quiet room)
so Path B (`_micLoudFrames ≥ 3`) may accumulate — the IOS crush bug may NOT affect the mic-qualify
pill, only the phrase gate. DOCUMENTS for further investigation.

---

## IOS_AMPLITUDE_CRUSH Root Cause (Definitive)

**Symptom:** Rob 7:50 screenshot — "RMS ~3%, digits work, greeting stuck."  
**Fixture confirms:** `IOS_AMPLITUDE_CRUSH` generates RMS = `4/128 = 0.0313`, vbRatio = 0.85.

**Dead zone mechanism:**
```
VAD_SILENCE_RMS_FALLBACK = 0.030
VAD_SPEECH_RMS_FALLBACK  = 0.055
RMS_CRUSH                = 0.031

0.030 < 0.031 < 0.055  →  NEITHER BAND
  silence branch: skipped (rms > 0.030)   → ticks don't decay, no recovery timer
  voiced branch:  skipped (rms < 0.055)   → ticks don't accumulate
  result: phraseVoicedTicks = 0 forever
```

**Starvation escape path:**
```
_vadStarved requires _rms < 0.02 for 60+ frames
iOS crush RMS = 0.031 > 0.02
→ starvation counter never increments
→ _vadStarved stays false
→ spectral escape path inactive
```

**Test assertion:** test #13 `PHRASE [BUG REPRODUCED]: IOS_AMPLITUDE_CRUSH` — PASSES (confirms bug).

**Fix candidates (next lane, not this scope):**
1. Lower `VAD_SPEECH_RMS_FALLBACK` from 0.055 to ~0.025 to capture iOS-crushed voice
2. Lower starvation threshold from `_rms < 0.02` to `_rms < 0.04` to include the dead zone
3. Add a voice-band-only path: when `_vbRatio >= 0.45` regardless of amplitude, count a voiced tick
   (requires new sensitivity analysis — must not admit 60Hz hum or broadband noise)

All three candidates must be validated against the fixture suite before merging.

---

## JSON Output Reference

Machine-readable results at `docs/strategic/ceremony-harness-results-s164.json` (Node mirror tier
only — the `tier` field marks this; a Playwright-tier JSON export was not added in this lane since
that tier hasn't executed yet).

---

## Test History

| Run | Date | Tier | Tests | Result |
|-----|------|------|-------|--------|
| 1 | 2026-08-16 | Node mirror | 23 | 20/23 FAIL (fixture RMS design error) |
| 2 | 2026-08-16 | Node mirror | 23 | 22/23 FAIL (avVbSustain cap too low: 25→35) |
| 3 | 2026-08-16 | Node mirror | 23 | **23/23 PASS** |
| 4 | 2026-08-16 | Node mirror | 24 | **24/24 PASS** (re-verified after adding the AV mic-qualify injection seam + its source-anchor test — 23→24) |
| 5 | 2026-08-16 | Node mirror | 25 | **25/25 PASS** (added VOICE_BAND_MIN_RATIO dual-declaration agreement test — a code-review finding: the constant is declared twice in source and the extractor only matched the first occurrence, 24→25) |
| 6 | 2026-08-16 | Playwright real-gate | 15 | NOT RUN in this sandbox (see design doc "What Was and Wasn't Verified"); `--list` collection succeeds; a live run reaches and fails only at `browserType.launch` (missing system libs, no root) |
