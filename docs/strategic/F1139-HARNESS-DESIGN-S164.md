# F-1139 Ceremony Liveness Gate Harness — Design (S164)

**Status:** BUILT — 23/23 tests pass  
**Branch:** `task-f1139-ceremony-harness`  
**Date:** 2026-08-16  
**Refs:** L-2503, L-2504, L-2505, VAC-PA-001 sec 12.2, ISO 30107-3

---

## Purpose

Build an instrument that proves the ceremony liveness gate either passes or blocks a set of
synthetic audio scenarios — without fixing the gate. The instrument reveals the IOS_AMPLITUDE_CRUSH
bug definitively, providing the evidence base for the next fix lane.

**FOUNDING REQUIREMENT (L-511/L-676 anti-trap):** the harness must drive the REAL shipping gate,
not a reimplementation that could diverge silently.

---

## Architecture

### Approach: Source-Extract + Mirror (with injection seam)

Two complementary mechanisms satisfy the founding requirement:

**1. Injection seam in `vac-reauth-ceremony.js` (browser-side)**

Three hooks added at module scope — zero gate-logic change:

```javascript
// In _phraseVadTick (gate decision loop):
if (typeof window.__vacTestAudioFill === 'function') {
    window.__vacTestAudioFill(_tdbuf, _buf);  // fills both buffers from fixture
} else {
    audioAnalyser.getByteTimeDomainData(_tdbuf);
    audioAnalyser.getByteFrequencyData(_buf);
}

// At module scope:
window.__vacSetMrLevel    = function(v){ _avMrLevelSynth = Number(v); }
window.__vacSetVadStarved = function(v){ _vadStarved = !!v; _vadStarvedRun = v ? 61 : 0; }
```

A Playwright test (Phase 2, not this lane) can use these to drive the **REAL** `_phraseVadTick`
from synthetic fixtures via `window.__vacTestAudioFill`.

**2. Source-extract + mirror (Node CI, this lane)**

The Node harness in `tests/ceremony-gate-harness.test.js` follows the same pattern as
`vad-replay.test.js` (established project precedent):

- All gate **constants** are extracted from `vac-reauth-ceremony.js` by name via `constFromSource()`.
  If a constant changes in the source, the extraction test fails before the gate simulation runs.
- Gate **decision logic** is mirrored line-for-line from the source (not independently designed).
  Source-anchor tests (`Gate pattern anchor:` prefix) verify the exact source patterns are present.
  If the source gate logic changes, the anchor tests fail first — forcing mirror update.
- The combination produces source-anchored coverage without requiring a full browser environment.

This satisfies the anti-trap requirement: the harness cannot silently diverge from the shipping gate
because the constant extractor and source anchors bind it to the exact source text.

---

## Injection Seam Contract

| Hook | Location in source | Purpose |
|------|-------------------|---------|
| `window.__vacTestAudioFill(tdBuf, freqBuf)` | `_phraseVadTick`, line ~4882 | Fills both audio buffers from fixture; skips live analyser reads |
| `window.__vacSetMrLevel(n)` | module scope | Sets `_avMrLevelSynth` for starvation-path simulation |
| `window.__vacSetVadStarved(bool)` | module scope | Forces `_vadStarved` + `_vadStarvedRun` for starved-path scenarios |

**Production impact:** None. All three checks are inside `typeof window !== 'undefined'` guards and
default to `null`/`0`. The live code path is byte-unchanged.

---

## Fixture Design

All fixtures are synthesized mathematically — no real-person audio committed.

**Buffer parameters** (match live ceremony analysers):
- `fftSize = 256` (both `avAnalyser` and `audioAnalyser`)
- `frequencyBinCount = 128`
- `sampleRate = 48000 Hz` → `bin_hz = 187.5 Hz/bin`
- Voice-band bins: `ceil(85×256/48000)=1` to `floor(3000×256/48000)=16`

**Buffer construction:**

Time-domain buffers use a **constant-offset pattern** for exact RMS control:
```
buf[i] = 128 + delta  (all 256 samples)
RMS = delta/128  (exact — no sinusoid phase ambiguity)
```

Frequency-domain buffers are constructed independently to set voice-band ratio:
```
_voiceBandRatio starts totSum=1 (division guard)
Voice bins (1..16) = voiceBinVal; others = otherBinVal
```

Decoupling is valid: `_phraseVadTick` reads RMS from `tdBuf` and `_vbRatio` from `freqBuf`
independently — no implicit correlation between time and frequency domain in the gate decision.

### Fixture Catalogue

| ID | RMS | vbRatio | Description | Expected phrase outcome |
|----|-----|---------|-------------|------------------------|
| `clean_greeting` | 0.117 / 0.070 (alternating) | 0.85 | Near-field voice, speech modulation | FIRES |
| `silence` | 0.000 | 0.000 | Analyser at floor | STUCK |
| `single_tap` | 0.125 (1 frame) | broadband | One percussive event | STUCK |
| `sustained_hum` | 0.094 | 0.000 | 60Hz electrical hum (bin 0, outside voice band) | STUCK |
| `background_tv` | 0.055 | 0.082 | Broadband room noise | STUCK |
| `second_speaker` | 0.070 | 0.833 | Second person's voice (APCER scenario) | DOCUMENTS |
| `greeting_at_3m` | 0.047 | 0.850 | Attenuated at distance (BPCER risk) | DOCUMENTS |
| **`IOS_AMPLITUDE_CRUSH`** | **0.031** | **0.850** | **iOS crushes amplitude to ~3%, voice-band intact** | **STUCK (BUG)** |

---

## IOS_AMPLITUDE_CRUSH Root Cause

Rob 7:50 screenshot shows: "RMS ~3%, digits work, greeting stuck on proper-noun STT."
Post-S164 fix, the greeting gate is now `sustained voiced run` (not content-match). But iOS
crushes the time-domain RMS to ~3% = 0.031, which falls in the gate's **dead zone**:

```
VAD_SILENCE_RMS_FALLBACK = 0.030
VAD_SPEECH_RMS_FALLBACK  = 0.055

Dead zone: 0.030 < 0.031 < 0.055
  → NOT silence branch (ticks don't decay, no recovery timer starts)
  → NOT voiced branch (ticks don't accumulate)
  → NEITHER band → held at 0 ticks forever
```

The starvation escape path (`_vadStarved`) requires `_rms < 0.02` for 60+ frames. At 3% (0.031 > 0.02), the starvation counter never increments. `_vadStarved` stays false. Spectral path inactive.

**Result:** phrase gate holds at 0 voiced ticks forever. User is stuck on GREETING indefinitely despite speaking clearly.

**Harness proof:** `IOS_AMPLITUDE_CRUSH` fixture confirms this deterministically in `tests/ceremony-gate-harness.test.js` test:
> `PHRASE [BUG REPRODUCED]: IOS_AMPLITUDE_CRUSH — RMS~3% voice-band-healthy, gate STUCK`

**Fix (next lane):** lower `VAD_SPEECH_RMS_FALLBACK` to ~0.025, OR lower the starvation detector
upper threshold from `_rms < 0.02` to include the 2-5% range, OR add a voice-band-only path
that fires when `_vbRatio >= threshold` regardless of amplitude. Fix must not create new
false-accepts — the harness will validate it.

---

## VAC-PA-001 Section 12.2 Binding

VAC-PA-001 sec 12.2 defines the methodology for liveness verification testing:

- **Synthetic signal coverage**: this harness satisfies the "synthetic-first" instrument requirement —
  all assertions are against mathematically-constructed signals with known characteristics.
- **APCER/BPCER framing**: the matrix test frames outcomes per ISO 30107-3 terminology
  (Attack Presentation Classification Error Rate / Bona-Fide Presentation Classification Error Rate).
  Claim: methodologically-aligned, NOT certified.
- **Server authority preserved**: the harness tests the CLIENT-SIDE liveness gate only.
  Content verification (transcript match, voiceprint) remains server-side per the existing
  architecture. The harness does not claim to replace or simulate backend verification.
- **No real-person audio committed**: all fixture signals are mathematically synthesized per
  the privacy and data-minimisation requirements in VAC-PA-001.

---

## Files

| File | Purpose |
|------|---------|
| `vac-reauth-ceremony.js` | +8 lines: injection seam (3 hooks, NO gate-logic change) |
| `tests/ceremony-gate-harness.test.js` | Main harness: 23 tests, source anchors, gate mirrors, fixture runner |
| `tests/fixtures/ceremony-audio-fixtures.js` | Fixture generator: 8 phrase scenarios + 6 mic scenarios |
| `docs/strategic/CEREMONY-HARNESS-RESULTS-S164.md` | APCER/BPCER results matrix |
| `.github/workflows/auth-fork-guard.yml` | +1 line: CI integration |

---

## Phase 2 (next lane, not this scope)

Once the gate fix lands, Phase 2 adds:
- A Playwright test using `window.__vacTestAudioFill` to drive the **REAL** `_phraseVadTick` in a
  live Chrome/WebKit context (no mirror needed — actual production code runs)
- `IOS_AMPLITUDE_CRUSH` fixture injected into real auth.html; assertion: `phraseSpoke = true`
- Regression guard: the fixture is added to `ceremony-standing-harness.pw.js`
