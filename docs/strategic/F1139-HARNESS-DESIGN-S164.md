# F-1139 Ceremony Liveness Gate Harness — Design (S164)

**Status:** TWO TIERS BUILT.
- Node mirror tier (`tests/ceremony-gate-harness.test.js`): 25/25 tests **executed and passing**
  in this sandbox (`node --test`, no browser required) — see run output below.
- Real-gate Playwright tier (`tests/ceremony-harness-fixtures.pw.js`): written against the F-1139
  injection seam, structurally validated (`playwright test --list` enumerates all 15 fixture tests (14 fixture-driven + 1 starvation-escape control)
  correctly; a live run confirms failure is exactly "missing browser shared libraries," not a
  test-authoring bug — see "What Was and Wasn't Verified" below) but **not executed end-to-end**.
  The authoring sandbox has no root/sudo, so `playwright install --with-deps chromium` cannot
  install the system libraries (libglib2.0, libnss3, libatk, libgtk, …) headless Chromium needs.
  CI (`.github/workflows/ceremony-harness-fixtures.yml`, ubuntu-latest + sudo) is authoritative for
  this tier — check its run status on this branch before treating its assertions as confirmed.

**Branch:** `task-f1139-ceremony-harness`  
**Date:** 2026-08-16  
**Refs:** L-2503, L-2504, L-2505, VAC-PA-001 sec 12.2 (not found in this repo checkout — see below), ISO 30107-3

---

## Purpose

Build an instrument that proves the ceremony liveness gate either passes or blocks a set of
synthetic audio scenarios — without fixing the gate. The instrument reveals the IOS_AMPLITUDE_CRUSH
bug definitively, providing the evidence base for the next fix lane.

**FOUNDING REQUIREMENT (L-511/L-676 anti-trap):** the harness must drive the REAL shipping gate,
not a reimplementation that could diverge silently.

---

## Architecture

### Approach: Source-Injectable Seam (primary) + Source-Extract Mirror (secondary, fast CI sensor)

**Correction to an earlier draft of this doc:** the injection seam was originally added (first
commit on this branch) with no consumer — the Node harness mirrored the gate logic by hand instead
of driving the seam, and this doc's Status line claimed the anti-trap requirement was satisfied by
that mirror alone. It wasn't: a hand-written mirror, however carefully anchored to source constants
and source-text patterns, is still a reimplementation — exactly the failure mode L-511/L-676 names.
This revision adds the missing consumer (`tests/ceremony-harness-fixtures.pw.js`) so the seam is
actually load-bearing, and demotes the mirror to what it honestly is: a fast, source-anchored
secondary sensor in the same spirit as `vad-replay.test.js` (which makes no anti-trap claim for
itself), not the thing that satisfies Step 1.

**1. Injection seam in `vac-reauth-ceremony.js` (drives the REAL gate — primary tier)**

Four hooks added at their exact analyser-read call sites / module scope — zero gate-logic change,
each guarded by `typeof window.__vac... === 'function'` so the live (non-test) path is byte-identical
when the hook isn't set:

```javascript
// In _phraseVadTick (phrase/greeting gate decision loop, ~line 4880):
if (typeof window.__vacTestAudioFill === 'function') {
    window.__vacTestAudioFill(_tdbuf, _buf);  // fills both buffers from fixture
} else {
    audioAnalyser.getByteTimeDomainData(_tdbuf);
    audioAnalyser.getByteFrequencyData(_buf);
}

// In runAVFrame (AV preflight mic-qualify block, ~line 1360):
if (typeof window.__vacTestAvAudioFill === 'function') { window.__vacTestAvAudioFill(dataArray, _fbuf); }
else { avAnalyser.getByteTimeDomainData(dataArray); avAnalyser.getByteFrequencyData(_fbuf); }

// At module scope (starvation-path scenarios):
window.__vacSetMrLevel    = function(v){ _avMrLevelSynth = Number(v); }
window.__vacSetVadStarved = function(v){ _vadStarved = !!v; _vadStarvedRun = v ? 61 : 0; }
```

`tests/ceremony-harness-fixtures.pw.js` (Playwright, real Chromium) sets `window.__vacTestAudioFill`
/ `window.__vacTestAvAudioFill` to serve fixture frames, then drives the **actual, unmodified**
`_phraseVadTick` / `runAVFrame` mic-qualify block through the ceremony's own timers
(`phraseInterval` / `requestAnimationFrame`) — nothing about the RMS calculation, voice-band ratio,
sustain counters, or `PHRASE_VOICED_TICKS_NEEDED` / `PHRASE_MOD_DELTA` / `_micQualifyFloor` gating
is reimplemented. This is the tier that satisfies the founding requirement.

Media bootstrap: rather than hand-mocking `getUserMedia`/`AudioContext` (a mocked, non-real
`MediaStream` object fails real `AudioContext.createMediaStreamSource()` validation in Chromium,
which would leave `avAnalyser`/`audioAnalyser` null and silently defeat the harness), Chromium is
launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. `requestCamera()`
then calls the real `getUserMedia` and receives a real (synthetic) camera+mic `MediaStream` — real
analysers attach, real video playback progresses, no permission-dialog stall. The fake device's own
audio content is irrelevant: the injection seam overwrites the analyser buffers before the gate ever
reads them, so fixture bytes — not whatever tone Chromium's fake mic emits — drive the decision.

**2. Source-extract + mirror (Node CI, fast secondary sensor)**

The Node harness in `tests/ceremony-gate-harness.test.js` follows the same pattern as
`vad-replay.test.js` (established project precedent) and makes the same, narrower claim
`vad-replay.test.js` makes for itself — NOT an anti-trap-satisfying claim on its own:

- All gate **constants** are extracted from `vac-reauth-ceremony.js` by name via `constFromSource()`.
  If a constant changes in the source, the extraction test fails before the gate simulation runs.
- Gate **decision logic** is mirrored line-for-line from the source (not independently designed).
  Source-anchor tests (`Gate pattern anchor:` prefix) verify the exact source patterns are present.
  If the source gate logic changes, the anchor tests fail first — forcing mirror update.
- Value: this tier runs in ~100ms with zero browser dependency, so it catches constant/pattern
  drift on every `git push` (wired into `auth-fork-guard.yml`) well before the slower Playwright
  tier runs. It cannot, by construction, prove the mirror's control flow matches the source's
  control flow byte-for-byte — only that the named constants and literal text patterns it anchors
  on are still present. The Playwright tier is what closes that gap.

---

## Injection Seam Contract

| Hook | Location in source | Purpose |
|------|-------------------|---------|
| `window.__vacTestAudioFill(tdBuf, freqBuf)` | `_phraseVadTick`, line ~4880 | Fills both phrase-gate audio buffers from fixture; skips live analyser reads |
| `window.__vacTestAvAudioFill(tdBuf, freqBuf)` | `runAVFrame`, line ~1360 | Fills both AV-preflight mic-qualify buffers from fixture; skips live analyser reads |
| `window.__vacSetMrLevel(n)` | module scope | Sets `_avMrLevelSynth` for starvation-path simulation |
| `window.__vacSetVadStarved(bool)` | module scope | Forces `_vadStarved` + `_vadStarvedRun` for starved-path scenarios |

**Production impact:** None. All four checks are `typeof window.__vac... === 'function'` guards that
fall through to the original `analyser.getByteTimeDomainData/getByteFrequencyData` calls when unset.
The live (non-test) code path is byte-identical to pre-F-1139 behavior.

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

**`docs/standards-drafts/VAC-PA-001-v0.md` does not exist in this repo checkout** — searched the
full working tree (`docs/`, root, `HANDOFF.md`) for `VAC-PA-001`, `standards-drafts`, and the cited
learning-inbox IDs (L-2503/L-2504/L-2505/L-511/L-676/L-2150) outside of this branch's own commits;
none were found. It may live in a separate repo (the task envelope names `athena`, `vac-protocol`,
`vac-web`, `folioai-mvp` as the repos this task family spans) not accessible from this working
directory. Rather than fabricate a citation to a document that couldn't be read, this section states
the general posture this repo already takes elsewhere (`standards.html`, `athena-protocol.html`,
`scoring.html` all cite ISO/IEC 30107-3 for the Didit-held Level 1 PAD certification, with VAC's own
30107 certification "planned," not held) and applies the same non-overclaim discipline here:

- **Synthetic signal coverage**: all assertions are against mathematically-constructed signals with
  known characteristics — no real-person audio is committed (privacy/data-minimisation, independent
  of whatever VAC-PA-001 specifically requires).
- **APCER/BPCER framing**: the matrix frames outcomes per ISO/IEC 30107-3 terminology (Attack
  Presentation Classification Error Rate / Bona-Fide Presentation Classification Error Rate).
  **Claim: methodologically-aligned, NOT a certified evaluation** — matching how this repo already
  describes its one actual certified component (Didit's iBeta Level 1 PAD) versus VAC's own
  (uncertified, "planned") posture. This harness is neither.
- **Server authority preserved**: the harness tests the CLIENT-SIDE liveness gate only. Content
  verification (transcript match, voiceprint) remains server-side per the existing architecture
  (`engine.py:verify_voice`, `main.py` composite scorer). The harness does not claim to replace or
  simulate backend verification.
- **If VAC-PA-001 sec 12.2 turns out to specify something this harness's approach conflicts with**
  (e.g. a required fixture count, a specific APCER/BPCER threshold, a different injection posture),
  this section needs a follow-up pass once the document is available — flagging that explicitly
  rather than silently matching whatever the task envelope implied it said.

---

## Files

| File | Purpose |
|------|---------|
| `vac-reauth-ceremony.js` | +14 lines total: 4-hook injection seam (phrase gate + AV mic-qualify + 2 starvation setters), NO gate-logic change |
| `tests/ceremony-gate-harness.test.js` | Fast Node mirror tier: 25 tests, source anchors + constant extraction + mirrored gate logic |
| `tests/ceremony-harness-fixtures.pw.js` | **Real-gate Playwright tier**: drives the actual `_phraseVadTick` / mic-qualify block via the injection seam, in real Chromium |
| `tests/fixtures/ceremony-audio-fixtures.js` | Fixture generator (shared by both tiers): 8 phrase scenarios + 6 mic scenarios |
| `tests/fixtures/greeting-harness.html` | Pre-existing shared harness page (unmodified) — loads `vac-reauth-ceremony.js`, reused from `greeting-audible.pw.js` |
| `docs/strategic/CEREMONY-HARNESS-RESULTS-S164.md` | APCER/BPCER results matrix, both tiers |
| `.github/workflows/auth-fork-guard.yml` | +1 line: wires the Node mirror tier into the existing fast CI guard |
| `.github/workflows/ceremony-harness-fixtures.yml` | New workflow: installs Chromium (`--with-deps`, needs the sudo CI has and this sandbox doesn't) and runs the Playwright tier |

---

## What Was and Wasn't Verified (read this before trusting the matrix)

**Executed in this sandbox, real results:**
- `node --test tests/ceremony-gate-harness.test.js` — 25/25 pass (Node mirror tier; a
  reimplementation cross-check, not proof the real gate behaves this way).
- `node -c vac-reauth-ceremony.js` — the injection seam edits keep the file syntactically valid.
- `node_modules/.bin/playwright test tests/ceremony-harness-fixtures.pw.js --list` — all 14 fixture
  tests are collected correctly (fixture require, `test.use()` launch args, and the test bodies all
  parse and evaluate without error at collection time).
- A live single-test run of the Playwright tier was attempted and failed at `browserType.launch`
  with `error while loading shared libraries: libglib-2.0.so.0` — i.e. it got past every step of
  test setup and failed exactly where "no root, can't install Chromium's system deps" predicts it
  would, not at some earlier authoring mistake.

**NOT executed — CI-pending:**
- Whether the Playwright tier's assertions actually pass against real Chromium (does
  `--use-fake-device-for-media-stream` really produce a `MediaStream` that
  `createMediaStreamSource()` accepts here; does `phraseInterval` actually reach
  `PHRASE_VOICED_TICKS_NEEDED` ticks within the wait budget; does `#avPillMic` actually gain `.good`
  for the mic-qualify fixtures). This requires `.github/workflows/ceremony-harness-fixtures.yml` to
  run on GitHub's ubuntu-latest runners (sudo available, `playwright install --with-deps` works —
  same setup the pre-existing `ceremony-selftest.yml` / `ceremony-standing-harness.yml` already use
  successfully in this repo). **Check that workflow's run status on this branch before citing the
  Playwright-tier PASS/FAIL column in `CEREMONY-HARNESS-RESULTS-S164.md` as confirmed.**

**Confidence on the IOS_AMPLITUDE_CRUSH conclusion specifically:** independent of either test tier,
the dead-zone argument (`0.030 = VAD_SILENCE_RMS_FALLBACK < 0.031 (fixture RMS) < 0.055 =
VAD_SPEECH_RMS_FALLBACK`, and `0.031 > 0.02` so the starvation escape never arms) is a direct
reading of the shipped constants and the `_phraseVadTick` control flow (verified by hand against
`vac-reauth-ceremony.js` lines ~4863-4984 in this review) — not something that depends on either
test tier executing correctly. Both tiers exist to make that argument checkable by a machine on
every future change, not to establish it for the first time.

---

## Next Lane (genuinely out of scope here — the fix, not the harness)

This task is explicitly instrument-only: "DO NOT fix the gate in this lane." Once a fix candidate
exists (see candidates in the Root Cause section above), the existing two-tier harness is what
validates it — add the fix, flip `IOS_AMPLITUDE_CRUSH`'s expected outcome to `PHRASE_FIRES` in both
`tests/fixtures/ceremony-audio-fixtures.js` and the assertions in both test files, and confirm nothing
in the reject set (`silence`/`single_tap`/`sustained_hum`/`background_tv`) starts firing (that would
be a new false-accept — D-MICTEST-GREENS-ON-NOISE regression). No new harness infrastructure should
be needed for that lane; both tiers already exist to receive it. Also add the `IOS_AMPLITUDE_CRUSH`
fixture (post-fix, expecting `PHRASE_FIRES`) as a permanent regression case in
`tests/ceremony-standing-harness.pw.js` — the existing nightly/merge-gate standing suite for exactly
this class of ceremony audio defect (see its SAGA-* catalogue) — so the fix can't silently regress
later the way the original bug went two days undetected.
