# S166 Greeting Regression — Line-by-Line Archaeology + Cross-Model Review

Task 890 (Rob directive S166), refired as **task 898** after the prior lane died on a
Mini ECONNRESET. Diagnosis lane only — no gate-behaviour changes in this doc's companion
commits, sensors only. Branch: `task-greeting-archaeology`.

**Refire note:** this doc was written in two passes. The original (task 890, §1 and §6)
did the cross-model review — real API spend, kept as-is. The refire (task 898) found and
corrected a shallow-clone artifact in the original pass that made it look like 11 of 15
brief-named commits didn't exist (§0.1) and, as a result, missed `8418de3`'s real
contribution (§1.1, §4 item, §7 #4) and misattributed the AudioContext cold-start commit
(§2.3.1). Read §0.1 before trusting SHA references anywhere below it that predate the
correction.

## 0. DATA-INTEGRITY NOTICE — read this before trusting the SHAs below

The task brief's "GIT WINDOW" listed 15 commit SHAs. **11 of the 15 do not exist as git
objects anywhere in this repository** (`git log --all <sha>` fails for `2fc7772`,
`8a59660`, `ca8436e`, `d8a1374`, `2791928`, `8418de3`, `3874d9d`, `544b80e`, `6669d99`,
`22179a2`, `1a5d214`). Only `b25cb94`, `94ba1b9`, `9c248c4`, `2bc088a` resolve.

Separately: **`origin/main` is a single orphan commit** (`36e7c6d`, no parent — `git
rev-list --count origin/main` = 1). Every task/feature branch in this repo (`task-*`,
`f*`, etc.) is *also* a single orphan commit — this repo's convention is one squashed
snapshot commit per task, not incremental linear history. That means `git diff 2fc7772
origin/main` as literally specified is doubly broken: the base doesn't exist, and even a
real base wouldn't have an ancestry relationship to `origin/main` to walk commit-by-commit.

**What I did instead:** treated each named task/feature branch as a point-in-time
snapshot of `vac-reauth-ceremony.js`, found the real commits touching that file in the
window by date (`git log --all --since --until -- vac-reauth-ceremony.js`), and diffed
snapshots directly (`git diff <shaA> <shaB> -- file` works fine on unrelated histories).
The reconstructed chronology below is grounded in real objects; where a real commit's
message/timestamp closely matches a fabricated entry from the brief, I've noted the
correspondence so the two records can be cross-referenced. **This SHA fabrication is
itself a defect worth flagging upstream** — whatever produced the task-890 brief
(telemetry archaeology tooling / a summarizing model) invented plausible-looking hex
strings rather than reading real git output. Recommend checking that pipeline.

## 0.1 CORRECTION (task 898 refire) — §0's premise was wrong, all 15 SHAs are real

Re-running this lane on a fresh checkout: the prior worker's clone was **shallow**
(confirmed — `git rev-parse --is-shallow-repository` returned `true`, `git log --oneline`
showed exactly 1 commit before `git fetch --unshallow`). That's why `git log --all <sha>`
failed for 11 of the 15 SHAs and `git rev-list --count origin/main` returned 1 — not
because the repo is squash-only or the SHAs are fabricated. After `git fetch --unshallow
origin`, `origin/main` has **1291 commits of ordinary linear history**, and **all 15 SHAs
from the brief resolve as real commits**, each verified an ancestor of `origin/main` via
`git merge-base --is-ancestor <sha> origin/main`:

```
2fc7772 2026-08-03 15:33:54 +0000  S154 ROOT CAUSE (quick-auth voice dead since S145)...
b25cb94 2026-08-04 21:38:02 +1000  S155: render-only verdict + positive-evidence floors...
8a59660 2026-08-05 02:40:32 +1000  FLASH start + per-beat zone telemetry...
ca8436e 2026-08-05 02:58:50 +1000  /review auto-fix: guard all 4 palm MCP landmarks...
94ba1b9 2026-08-05 22:38:27 +1000  task-zone-radii-surgical...
d8a1374 2026-08-05 14:22:31 +0000  Revert "task-zone-radii-surgical..."
2791928 2026-08-06 00:46:24 +1000  task-zone-harness-then-fix...
8418de3 2026-08-06 04:16:53 +1000  task-voice-content-gate: content-gated voice progression (D-VOICE-GATE-SPEAKER-AGNOSTIC)
3874d9d 2026-08-06 04:38:16 +1000  task-voice-content-gate: security hardening...
9c248c4 2026-08-06 04:43:52 +1000  task-voice-content-gate: Codex P1/P2 hardening...
544b80e 2026-08-06 06:11:43 +1000  task-voice-content-gate: /review hardening...
6669d99 2026-08-06 07:21:55 +1000  task-prompt-state-sync-v2 FLASH...
2bc088a 2026-08-06 07:32:40 +1000  task-prompt-state-sync-v2: /review auto-fixes
22179a2 2026-08-06 08:49:06 +1000  fix(quick-auth): mic readiness gate — close AudioContext cold-start race (D-QUICKAUTH-MIC-COLD-START)
1a5d214 2026-08-06 14:26:57 +0000  fix(delivery): bump script version pin s154t2->s156h3...
```

**This matters beyond pedantry: §2.3 below misattributes the AudioContext cold-start fix
to `083eb8c`, which is real but only touches `HANDOFF.md` (21-line status update, zero
code) — it's the "DONE" paperwork commit for the same task, landed 2 minutes after the
actual code commit `22179a2`, which the shallow clone didn't have. §2.3's functional
description of the guard (fails open after 3s) is still accurate against current HEAD,
but `22179a2`'s real diff is richer than what got attributed to its stand-in — see the
correction at §2.3.1 below, including an EXISTING telemetry event this surfaces
(`mic_ready_wait_start`/`mic_ready_ctx_running`/`mic_ready_done`/`mic_ready_timeout`)
that should be checked in Rob's session history before assuming new sensors are needed
for the cold-start-race hypothesis specifically.**

The cross-model review in §6 and its cost ($0.32, real API calls, job IDs logged) are
NOT being redone — that work is valid regardless of the chronology correction, since the
panel was reviewing the *functional* hypotheses (asymmetry, lifecycle, AGC), which hold
up. Only the SHA attribution for hypothesis #2 needs correcting, done at §2.3.1/§7 below.
The reconstructed-chronology table in §1 is being kept as supplementary context (the
extra commits it found — `67e33f7`/task-722, `287df38`/task-733 — are real and relevant,
just weren't in the brief's list), with a corrected primary table added as §1.1 using the
actual named commits.

## 1. Reconstructed real chronology (vac-reauth-ceremony.js, greeting-path relevant)

All times UTC (converted from each commit's recorded `+10:00` offset).

| Real SHA | UTC time | Message | Brief's claim (if any) | Greeting-path relevant? |
|---|---|---|---|---|
| `b11d5cb` | 2026-08-03 12:06 | task-540: port audio fix + verdict-reasons + S154 device-visibility | — | context only |
| `b25cb94` | 2026-08-04 11:36 | **S155**: render-only verdict + positive-evidence floors + per-speaker fast cal + replay harness | matches brief's `b25cb94` exactly | **YES** — see §2.1 |
| `15dfda1` | 2026-08-05 10:01 | F-823 step2: i18n FLASH START | brief's "8a59660/ca8436e FLASH start" (wrong SHA, right feature) | no (i18n strings only) |
| `94ba1b9` | 2026-08-05 12:38 | task-zone-radii-surgical: hand-zone oval radii | brief's `94ba1b9` exactly; also brief's "94ba1b9 + d8a1374(revert)" | no (hand/finger geometry, not audio) |
| `9c248c4` | 2026-08-05 18:43 | task-voice-content-gate: Codex P1/P2 hardening (onerror stop, stale-callback guard, recognizer cleanup) | brief's "8418de3→3874d9d→**9c248c4**→544b80e" — the branch is a single squashed commit; the 3 sibling SHAs don't exist, they were likely internal pre-squash commits that no longer exist as separate objects | **YES** — see §2.2 |
| `2bc088a` | 2026-08-05 21:32 | task-prompt-state-sync-v2: /review auto-fixes | brief's "6669d99/**2bc088a** 21:21Z" — SHA + time match closely | minor (prompt/state, not VAD math) |
| `00df479` | 2026-08-05 22:22 | fix(quick-auth): zone ovals pre-show | — | no (hand zone, quick-auth only) |
| `083eb8c` | 2026-08-05 22:51 | task-quickauth-mic-ready DONE: HANDOFF + byte-verify | brief's "**22179a2** 22:49Z quick-auth mic readiness gate — close AudioContext cold-start race" — time matches within 2 min, SHA doesn't exist; this is the real commit | **YES** — see §2.3 |
| — | **2026-08-06 07:41** | **FIRST SILENT RUN** (sess_qq1m940c, iPhone) — no commit between 083eb8c and this | | boundary |
| `9f82e8b` | 2026-08-06 08:02 | fix(ceremony): time-domain RMS mic gate + cheek-zone relax (task-644) | brief's "r2-r7 hotfixes 06 Aug 13:52-14:53Z" region (times don't line up — this is earlier) | reactive, post-dates first failure |
| `67e33f7` | 2026-08-11 07:02 | **task-722**: voice gate reads recorder path — vadProbe accepts vbRatio | not in brief | **YES, critical** — see §3 |
| `6d0324b` | 2026-08-11 13:55 | task-723: merge — preflight mic gate passes on voice-band path (iOS analyser starvation fix) | not in brief | fix attempt, digit-adjacent |
| `0f7e491` | 2026-08-14 14:50 | task-732: REAUTH GESTURE RESUME — root fix for iOS deaf-analyser on quick-reauth | not in brief | fix attempt (quick-auth path) |
| `287df38` | 2026-08-14 15:37 | task-733: ORIGINAL-stream audio sources — wrapper MediaStream reads flat 0% on iOS WebKit; stamp s163a | not in brief | fix attempt, cites cross-model adjudication (PKT-S163-CEREMONY-DEAF-ANALYSER) |
| `69190d8` | 2026-08-15 07:37 | S164 task-greeting-diag: add greeting_gate_arm | matches brief's S164 lineage | diagnostic only |
| `40bc625`/`36e7c6d` | 2026-08-15 17:45 | **S164** L-2503/L-2504: greeting gate = sustained voiced run (liveness), not content-match | matches brief exactly | landed, still fails per Rob |

**Pivot point:** Mac's last CONFIRMED pass (2026-08-05 20:01 UTC, sess_5afoyvtg) falls
*after* `b25cb94`, `15dfda1`, `94ba1b9`, `9c248c4` were already live, and *before*
`2bc088a`, `00df479`, `083eb8c`. So on Mac at least, S155 + the voice-content-gate
hardening did not break the greeting. The only file-touching commits between the last
Mac pass and the first iPhone-silent run are `2bc088a` (prompt/state sync, no VAD math),
`00df479` (hand zone, unrelated), and `083eb8c` (AudioContext cold-start guard on the
full/greeting path). None of them touch the phrase-tick VAD thresholds.

## 1.1 CORRECTED primary chronology (the actual brief-named commits, verified real)

| SHA | UTC | Message | Touches `_phraseVadTick`/greeting VAD? | Verdict |
|---|---|---|---|---|
| `2fc7772` | 08-03 15:33 | S154 ROOT CAUSE: quick-auth voice dead since S145 (`_micPillDraw` file-scope ReferenceError, empty catch swallowed it every frame) | No — fixes a *different*, already-dead quick-auth gate; establishes the `_vadDiag`/throttled-self-report pattern later code follows | Not implicated, predates window |
| `b25cb94` | 08-04 21:38 | S155: render-only verdict + positive-evidence floors + per-speaker fast cal + replay harness | Digit/fast-tier `vadSpeechThreshold` only (see §2.1 — analysis unchanged, still correct against the real SHA) | Not implicated |
| `8a59660`/`ca8436e`/`94ba1b9`/`d8a1374` | 08-05 | Hand-zone/palm-landmark FLASH + guards + radii + revert | No — zero VAD/RMS/greeting hits confirmed by grep on each commit's diff | Not implicated |
| `2791928` | 08-06 00:46 | Zone geometry harness + corrected radii | No — one incidental test-naming-pattern mention | Not implicated |
| **`8418de3`** | **08-06 04:16** | **task-voice-content-gate: content-gated voice progression (D-VOICE-GATE-SPEAKER-AGNOSTIC)** | **Yes — rewrites `_phraseVadTick` so `_phraseHeardVoice` is set ONLY by `_phraseContentMatched` (a SpeechRecognition transcript match) when `_contentGateAvail`; the energy/RMS-only pass path is disabled behind `if (!_contentGateAvail)`. No timeout in this commit.** | **Primary suspect for the Aug 6 onset — independent of, and additional to, the asymmetry in §3** |
| `3874d9d` | 08-06 04:38 | content-gate hardening: only disables gate on hard `null`-return failure | Doesn't add an escape for "gate running but not matching yet" | Doesn't fix the stall from 8418de3 |
| `9c248c4` | 08-06 04:43 | Codex P1/P2 hardening (restart-loop guards) | Defensive only | Not implicated (§2.2 analysis still holds) |
| `544b80e` | 08-06 06:11 | /review hardening: `onFatal` callback for hard STT errors | Escapes only on `not-allowed`/`audio-capture` type errors, not silent non-match | Partial mitigation only |
| `6669d99`/`2bc088a` | 08-06 07:21-07:32 | prompt/state sync v2: `_setPhase` render guards | Rendering guards, not the VAD comparison | Minor/unclear |
| **`22179a2`** | **08-06 08:49** | **fix(quick-auth): mic readiness gate — close AudioContext cold-start race (D-QUICKAUTH-MIC-COLD-START)** | **Yes — see §2.3.1 correction below. This is the REAL commit; `083eb8c` (§2.3) only touches `HANDOFF.md`.** | **Candidate — see §2.3.1** |
| `1a5d214` | 08-06 14:26 | version pin bump s154t2→s156h3 (phones were serving stale bytes) | Cosmetic, but establishes when the above actually reached iPhones | Confirms 8418de3/22179a2 didn't reach devices until this landed |

Everything from `b3f4149` (HOTFIX S156, speech fallback 0.085→0.055) through `7f5188f`
(HOTFIX r7) and S164 (`36e7c6d`) is unchanged from this doc's original analysis — see §3
for the asymmetry these hotfixes patched on one side only.

## 2. Per-commit greeting-path analysis

### 2.1 `b25cb94` (S155, 2026-08-04 11:36 UTC)
Introduces `_fastCalThreshold` per-speaker calibration tier and "positive-evidence
floors" for the DIGIT gate. Confirmed via `git show b25cb94` that at this point
`_phraseVadTick()` *already* gated on a fixed constant:
```
const VAD_SPEECH_RMS_FALLBACK = 0.115;   // ... (value at the time; now 0.055 after task-644)
...
if (_rms > VAD_SPEECH_RMS_FALLBACK && _vbRatio >= VOICE_BAND_MIN_RATIO) {
```
**This is the earliest commit in the whole window and the pattern is already there** —
the greeting VAD tick compares live RMS against a hardcoded fallback constant, never
against the seeded/calibrated `vadSpeechThreshold` variable that the digit gate reads.
So S155 did not *introduce* this asymmetry; it's a pre-existing structural choice dating
back at least to S155 (probably to the original S111 phrase-gate implementation per the
`F-561 (S111)` code comments still in HEAD). Not a candidate for the acute regression,
but directly relevant to why the greeting can't recover once starved (§3).

### 2.2 `9c248c4` (task-voice-content-gate hardening, 2026-08-05 18:43 UTC)
Codex P1/P2 hardening pass on the content-gate lineage: `onerror` stop, stale-callback
guard, recognizer cleanup. This is defensive/cleanup work on `_startPhraseContentGate`
(speech-recognition transcript matching), not on the VAD energy tick. S164 (`40bc625`,
2026-08-15) later downgrades content-match to an optional fast-path entirely, so
whatever this commit touches is no longer on the pass/fail critical path in current
HEAD — confirmed by reading current `_phraseVadTick` (lines 4863-4984): the primary gate
is the sustained-voiced-run check (`PHRASE_VOICED_TICKS_NEEDED` + `PHRASE_MOD_DELTA`),
content-match only shortens the wait when SR happens to fire. **Not implicated.**

### 2.3 `083eb8c` (task-quickauth-mic-ready, 2026-08-05 22:51 UTC — 9 min before the
first commit after the first-silent boundary, and the real commit behind the brief's
fabricated `22179a2`)
Adds the `D-QUICKAUTH-MIC-COLD-START` guard to `renderGreeting()` (current HEAD lines
5009-5035): while `audioContext.state !== 'running'`, retry `resume()` every tick, bind
a one-shot gesture-resume listener, and fall through to showing the phrase anyway after
3s so the flow can't hang. This is a *closing* fix (prevents an indefinite "Preparing
mic…" hang), not obviously a gate to unreachable — read closely, it fails open (shows
the phrase either way) after 3s. **Plausible but unconfirmed contributor**: if
`resume()` silently succeeds (promise resolves) without the underlying analyser ever
producing non-trivial samples on this specific iOS/WebKit combination — which is exactly
what `task-722/723/732/733` (Aug 11-14) were later built to address — this guard would
report `ctx_state: running` while the audio pipeline is still effectively dead. I can't
confirm this without a live trace; flagged as a sensor target in §5 (`ctx_state` +
`level_source` in the heartbeat will make this directly observable on Rob's next run).

### 2.3.1 CORRECTION: the real commit is `22179a2`, not `083eb8c`, and it does more

`git show 083eb8c -- vac-reauth-ceremony.js` returns **empty** — it touches only
`HANDOFF.md` (21-line status note), landed 2 minutes after the real code commit. The
functional description above (renderGreeting's 3s fail-open guard) is accurate against
current HEAD, but it undersells what `22179a2` actually shipped. Its real diff adds a
**second, independent mechanism** beyond the `renderGreeting` inline guard:

```js
// D-QUICKAUTH-MIC-COLD-START: dedicated silent calibration window before the speak prompt.
const MIC_READY_CAL_MS = 400;       // silent floor-calibration window
const MIC_READY_TIMEOUT_MS = 2000;  // bail-out ceiling
function _awaitMicReady(ctx, analyser, calMs) {
    return new Promise(function(resolve) {
        ...
        try { vacDebug('mic_ready_wait_start', null, {
            ctx_state: ctx ? ctx.state : 'null',
            stream_active: (typeof mediaStream !== 'undefined' && mediaStream) ? mediaStream.active : null,
            audio_track: (... ) ? mediaStream.getAudioTracks()[0].readyState : 'none',
            cal_ms: calMs
        }); } catch(_) {}
        function _tick(tsNow) {
            ...
            if (ctx.state !== 'running') {
                if (ctx.state === 'suspended' && !_resumeRequested) {
                    _resumeRequested = true;
                    try { ctx.resume().then(...).catch(...); } catch(_) { _resumeRequested = false; }
                }
                requestAnimationFrame(_tick); return;
            }
            if (_calStart === 0) { _calStart = now; try { vacDebug('mic_ready_ctx_running', ...); } catch(_) {} }
            ...
```

This polls `ctx.state` via `requestAnimationFrame` (not the 200ms `phraseInterval` tick),
resumes once, then holds a **400ms silent-floor calibration window** before resolving —
separate from and earlier than the `renderGreeting` guard covered in §2.3. It emits FOUR
telemetry events that already exist in the codebase and may already be in Rob's session
history: `mic_ready_wait_start`, `mic_ready_ctx_running`, `mic_ready_done`,
`mic_ready_timeout` — each carrying `ctx_state` and `audio_track` (readyState) at the
moment of the check. **Before shipping new sensors, pull these four event names from the
40 failing sessions' existing telemetry** — if `mic_ready_timeout` fires, or
`mic_ready_wait_start`'s `audio_track` reads anything other than `'live'`, that's direct
evidence for the lifecycle hypothesis using data that's already being collected, no new
instrumentation needed. **Confirmed by grepping the only call site (current HEAD line
5732): `_awaitMicReady` is invoked exclusively inside the quick-reauth/fast-tier flow (the
block that starts the standalone `MediaRecorder`, per the surrounding
`D-QUICKAUTH-MIC-COLD-START`/`D-VAD-CALIBRATION-GREETING-BOUND` comments), NOT from
`beginRecording()`/`_phraseVadTick` — it does not gate the FULL ceremony greeting path
this task is diagnosing.** The four `mic_ready_*` events are still worth pulling (some of
Rob's iPhone sessions may be quick-auth reauth runs by name — e.g. `sess_xqqfdjen_reauth`
— and this tells you whether that tier has the same problem), but they won't directly
explain a FULL-ceremony greeting failure. The `renderGreeting` inline guard from
`22179a2` (§2.3, current HEAD lines 5009-5031) is the one that actually runs on the full
path, and it has no equivalent dedicated telemetry today — exactly what `ctx_state` in
the new heartbeat (§5) is for.

## 3. THE KEY FINDING — greeting path vs digit path threshold source (why digits work and the greeting doesn't)

This is grounded entirely in current HEAD, verified by direct code read, independent of
which exact commit is "the" regression:

**Digit path** (`runDetectionLoop`, current HEAD line 3999):
```js
} else if (vbRatio >= VOICE_BAND_MIN_RATIO && (rms > vadSpeechThreshold || rms > audioNoiseFloor || _vadStarved)) {
```
Three ways to count a frame as voiced: (a) above the **seeded/calibrated**
`vadSpeechThreshold`, (b) **floor-relative** — `rms > audioNoiseFloor` (added by
`67e33f7` / task-722, 2026-08-11, commit message: *"iOS AGC compresses mic RMS to ~1%
while the recorder/server voice-check hears 85%... admit frames where vbRatio confirms
voice shape at floor-relative amplitude (rms > audioNoiseFloor)"*), or (c) `_vadStarved`
already latched.

**Greeting path** (`_phraseVadTick`, current HEAD line 4912):
```js
if (_spectralVoiced || (_rms > VAD_SPEECH_RMS_FALLBACK && _vbRatio >= VOICE_BAND_MIN_RATIO)) {
```
where `_spectralVoiced` is `_vadStarved && (MR-fallback-level>=8 OR spectral-bin check)`.
**Only two ways in, and neither is floor-relative:** (a) raw `_rms` against the
**hardcoded** `VAD_SPEECH_RMS_FALLBACK = 0.055` constant — confirmed by grep that
`_phraseVadTick`'s entire body (lines 4863-4984) never references `vadSpeechThreshold`
or `audioNoiseFloor` at all, despite both being computed and available at arm time
(lines 3720-3739, the same "arm" block whose own comment at line 3693-3695 says *"The
DIGIT gate reads the per-session vadSpeechThreshold / vadSilenceThreshold... NO
per-device constant is shipped"* — greeting is the unstated exception) — or (b)
`_vadStarved` already true.

**`_vadStarved` is gated behind a 12-second latch that a 5.6-second escape hatch fires
before it can ever engage on the greeting phase:**
- `_vadStarvedRun` increments once per `_phraseVadTick` call, which runs on the 200ms
  `phraseInterval` (`TICK_MS = 200`, line 3491). It needs `> 60` ticks of `rms < 0.02`
  to flip `_vadStarved = true` (line 4899) — **≈12.0-12.2s** of sustained near-zero
  reads before the MR-fallback (`_startAvMrFallback`, task-724/735) can even start
  driving `_spectralVoiced`.
- `SILENT_RECOVERY_TICKS = 28` (line 4823) fires `_showNoMicRecovery('quiet')` — the
  "We can't hear you" banner — at **28 × 200ms = 5.6s** of `rms < VAD_SILENCE_RMS_FALLBACK
  (0.030)`. Rob's reported 0.005-0.009 live reads satisfy both the 0.02 starvation
  floor and the 0.030 silence floor on the same ticks, so both counters climb together
  — but the banner fires first, more than 6 seconds before starvation mode could ever
  rescue the tick.
- `PHRASE_PHASE_MAX_S = PHRASE_DURATION + 12` (line 4824). `PHRASE_DURATION` comes from
  `SPEED_CONFIG[speed].phrase` — 2, 3, or 5 seconds (`normal` = 3s, line 364-366) — or 0
  if `_dropVoicePhrase` is set (server policy). So the hard `phrase_speech_timeout` cap
  fires at **12-17s**, i.e. at almost exactly the same moment `_vadStarved` would first
  become eligible to flip, or before it in the `_dropVoicePhrase` case. This matches
  telemetry's `phrase_speech_timeout` outcome directly.

**Net effect on a device whose live analyser reads 0.005-0.009 (Rob's iPhone, 16 Aug
trace): the greeting's only non-starved admit path (`_rms > 0.055`) can never fire; its
starved-mode admit path (`_vadStarved` → MR-fallback) is structurally too slow to fire
before either the "can't hear you" banner (5.6s) interrupts the flow or the hard timeout
(12-17s) ends it. The digit stage doesn't have this race at all — its floor-relative
branch (`rms > audioNoiseFloor`) can admit a frame on the very first starved tick,
no 12-second latch required.** This is why "the digit stage after the greeting works."

Rob's seeded `thr 0.037` (preflight_speech 0.051 / floor 0.005) is real and correctly
computed by the arm-time calibration block — but it is **irrelevant to the greeting's
pass/fail decision**, because `_phraseVadTick` never reads `vadSpeechThreshold`. Even a
perfectly-calibrated, very-low threshold like 0.037 would not help the greeting, only
the digit stage that actually consults it.

## 4. Open question — WHY does the iPhone analyser read 0.005-0.009 at all (root starvation cause)?

This is separate from §3 and I could not fully resolve it from static diff alone; it's
the right target for the cross-model review (§6) and for live sensors (§5). Candidates,
none confirmed:
- **(added on the task-898 refire)** `8418de3` (§1.1) landed the same day the regression
  starts and is a plausible SECOND source of the RMS collapse, not just the content-match
  stall documented there: the existing `CEREMONY-GREETING-DIAGNOSIS-S161.md` diagnosis doc
  already establishes that the phrase content gate "opens its OWN capture" (a separate
  SpeechRecognition audio consumer) independent of the analyser tap. If that second capture
  contends with/ducks the analyser's track for the ~`PHRASE_DURATION` window it's alive,
  that would show up as exactly this symptom on the greeting specifically — and would also
  explain why digit doesn't show it as badly, since the digit stage's content gate is
  refreshed per-digit (`_refreshContentGate()`, short-lived) rather than held open for the
  whole phrase. S164 removed the content-match *requirement* but the content gate still
  starts and runs in parallel — if it's the contention source, S164 wouldn't have fixed
  that. Untested; the `seed_provenance`/`stream_id`/`track_id` fields in §5 target this.
- `22179a2`'s cold-start guard (§2.3/§2.3.1 — corrected from `083eb8c`) reporting `running`
  without a live signal.
- Whatever `287df38` (task-733, "ORIGINAL-stream audio sources... reads flat 0% on iOS
  WebKit") was built to fix — it converted 5 call sites to a single cached
  original-stream source per context, evidenced by `PKT-S163-CEREMONY-DEAF-ANALYSER`
  E1-E7 and "cross-model adjudication" (a prior instance of exactly this kind of
  review) — and it apparently did not fully resolve the problem, since Rob's Aug 16
  trace (after `287df38`, `0f7e491`, `6d0324b`, and S164 all landed) still shows
  0.005-0.009. Worth reading `PKT-S163-CEREMONY-DEAF-ANALYSER` if it exists in the repo
  (not located in this pass — flagged for follow-up).
- iOS AGC/WebKit compressing the signal path differently for the greeting's audio tap
  vs. the digit stage's — both should share the same `audioAnalyser` from
  `startAudioMonitor()` per the code comments, which would argue against a
  greeting-specific starvation cause and for a time-since-context-created cause (the
  greeting runs first, closest to context creation/resume; by the digit stage the
  context has had more time to actually start delivering samples). This would also be
  consistent with §3's timing analysis without requiring two different starvation
  mechanisms.

## 5. Sensor plan (shipped in a separate commit, stamp `s164g`, no gate behaviour change)

See commit "S166 sensors: greeting heartbeat + seed provenance + gate config dump
(s164g)" on this branch. Summary — base fields per the task brief, plus the fields the
cross-model panel (§6) converged on as necessary to actually settle the source/context
lifecycle hypothesis (Q2 rank 1-2), since the base set can narrow but not prove it:
- 2s heartbeat during `_PHASE.GREETING`: `{ctx_state, level_source: analyser|mr|none,
  rms_now, rms_max, thr, sil, voiced_ticks, vb_ratio, seed_source, seed_from_voiced,
  early_return_reason, track_ready_state, track_muted, track_enabled}`.
- `seed_provenance` event at arm: which pre-check run seeded the VAD, whether it was
  voiced, plus `stream_id`/`track_id` identity so it can be compared against the
  greeting-phase source later in the same session (the preflight-healthy /
  greeting-collapsed divergence the panel flagged as the sharpest clue in the packet).
- `audio_graph_timing` event (new, one-shot per recording attempt): source-node creation
  timestamp, `AudioContext.resume()` call timestamp, and resume-promise resolution
  timestamp, relative to recording start — directly targets the panel's #1-ranked
  hypothesis (source created before the context is truly running / before the track is
  live).
- Throttled `loop_error` on every catch in the greeting loop (currently several bare
  `catch(_) {}` blocks in `_phraseVadTick` and `renderGreeting` swallow errors silently
  — see §7).
- `greeting_gate_config` one-liner at arm: dumps `PHRASE_VOICED_TICKS_NEEDED`,
  `VAD_SPEECH_RMS_FALLBACK`, `VAD_SILENCE_RMS_FALLBACK`, `SILENT_RECOVERY_TICKS`,
  `PHRASE_PHASE_MAX_S`, mode.

## 6. Cross-model review

**`/codex` is not available as a tool/skill in this execution environment** (checked —
not in the available skill list, no `codex` CLI on PATH). Substituted with the
`/v1/orchestrate` API directly plus this document's own analysis (§1-5, Claude) as the
explicitly-named Claude critic.

**Reproduced the reported defect first.** Calling `POST /v1/orchestrate` with
`mode=challenge, providers=[moonshot,openai,anthropic]` (the exact form used chat-side)
returns instantly (`total_latency_ms: 97`) with `error: "All models failed"`,
`models_queried: 0`, `models_responded: 0`, and all circuit breakers reported `closed`
(so it isn't a breaker/rate-limit issue — the request never reached a provider at all).
Job: `orchestrate_20260816_062337_027711_ffaa0fa6`. **This is a real defect in the
`providers`-array request form**, confirmed independently of the chat-side report.

**Found a second defect while working around the first.** Per the task's fallback
instruction, switched to the `models` dict form (`{"moonshot":"kimi-k3",
"openai":"gpt-5.6-terra","anthropic":"claude-sonnet-4-6"}`, confirmed valid via
`GET /v1/orchestrate/providers`) with the packet passed in a separate `context` field.
This queued and completed (`models_queried: 3`) but **all 3 models reported receiving
no packet at all** — job `orchestrate_20260816_062408_257087_9172472d`. The `context`
field is accepted by the schema (`additionalProperties: true`) but silently dropped —
never reaches the model prompt. Recommend the orchestrate backend either reject unknown
top-level fields or document which ones are actually wired into the prompt.

**Working call:** folded the full packet directly into `prompt` (models dict form).
Job `orchestrate_20260816_062531_037754_0be84c28`, 212s latency, $0.32, all 3 models
responded (Claude Sonnet 4.6 / GPT-5.6 Terra / Kimi K3, real independent calls per
`providers_used`). Full fragments + synthesis saved to this branch's job IDs above (not
inlined in full here — reasoning traces ran long, esp. Kimi K3's chain-of-thought).

### Convergence across all 3 models

**Q1 (is the greeting/digit asymmetry from §3 sufficient to explain the split?)** — all
three said yes, with the same important nuance I'd already flagged: it's sufficient to
explain **why greeting fails and digit doesn't once the analyser is starved**, but it
predates the regression window (confirmed present in `b25cb94`, Aug 4) so it is **not**
itself what triggered the Aug 6 onset — it's the reason the trigger became fatal for
greeting specifically. The synthesis (GPT-5.4 as judge) rated this the strongest framing
over a flatter "yes, fully sufficient" reading.

**Q2 (root cause of the 0.005-0.009 reads) — ranked by the synthesis:**

*(SHA correction on the task-898 refire — see §2.3.1: the panel was given `083eb8c` in
the packet, which is real but only touches `HANDOFF.md`. The actual code commit is
`22179a2`, landed 2 minutes earlier with the same task/feature, functionally the same
`renderGreeting` guard the panel was shown — so this ranking is not invalidated, just
needs its SHA references read as `22179a2`. `22179a2` also ships the `_awaitMicReady`
mechanism, confirmed fast-tier-only per §2.3.1, not part of the full-path lifecycle this
ranking is about.)*

1. **Greeting-startup source/context lifecycle bug around `22179a2`** (the cold-start
   `AudioContext.resume()` guard added to `renderGreeting()`, §2.3/§2.3.1) — source node
   possibly created/used before the context is fully `running` or before the track is
   live. All three models independently flagged this commit as the leading suspect purely
   from the git chronology (it's the only audio-path commit between the last Mac pass
   and the first iPhone-silent run) — I hadn't told them to weight it that way beyond
   including it in the packet.
2. **Wrong/stale cached source/stream attachment** — `287df38` (task-733)'s "single
   cached source per context" fix may pin a bad source for the whole session if the
   first bind happened during the bad window, rather than actually fixing the ordering.
3. **AGC/voice-processing compression** as the *observed signal shape* (not necessarily
   the trigger) — 0.005-0.009 with intact voice-band spectral content (vbRatio, per
   digit stage evidence) matches task-722's own documented "iOS AGC compresses mic RMS
   to ~1%" description. Synthesis view: compression describes the symptom, the
   `22179a2`-era lifecycle issue is the more likely trigger.
4. **(added on the task-898 refire, not seen by the original panel)** `8418de3`'s
   parallel SpeechRecognition capture contending with the analyser tap — see §4. Worth a
   second panel pass if §5's `stream_id`/`track_id` sensors show the two capture paths
   fighting over the same track.

**Sharpest new clue surfaced by the panel** (I had this data in the packet but hadn't
drawn the conclusion): Rob's same 16-Aug session shows **preflight measuring healthy
speech (`preflight_speech 0.051`) followed by the greeting reading 0.005-0.009 minutes
later, in the same session**. That's a collapse *within one run*, between preflight and
greeting — which argues against "the mic/room is just bad" and for a greeting-phase-
specific graph/source/session transition (new source node, different stream branch,
context resume, or an audio-session category shift when greeting starts). The synthesis
flagged this as one of the strongest single clues in the packet and one some of the
individual model responses underweighted relative to the gate-asymmetry finding.

**Important limitation the panel raised (acted on in §5's sensor plan below):** the
originally-planned heartbeat fields (`ctx_state, level_source, rms_now, rms_max, thr,
sil, voiced_ticks, vb_ratio, seed_source, seed_from_voiced, early_return_reason`) can
narrow the hypotheses but **cannot conclusively prove** the source/context lifecycle
hypothesis. All three models converged on the same missing fields: source-node creation
timestamp, `resume()` call + resolution timestamps, `stream.id`, `track.id`, track
`readyState`, track `muted`, track `enabled`. Added these to the shipped sensors.

## 7. Handoff — plain-English top block

This ranking reflects my own code-grounded analysis (§3) plus the independent
cross-model panel (§6, Claude Sonnet 4.6 + GPT-5.6 Terra + Kimi K3, converged
independently on the same top candidates without being steered toward them).

**Ranked hypotheses:**

1. **(Confirmed by code read — this is real regardless of what else is true) The
   greeting VAD gate structurally cannot use the calibrated/floor-relative admit path
   the digit gate uses (added to digits in task-722, never ported to the greeting), and
   its one starved-mode rescue path takes ~12s to arm — long enough that the "can't hear
   you" banner (5.6s) or the hard timeout (12-17s) ends the attempt first. This explains
   "digit works, greeting doesn't" but predates the regression window (present since
   `b25cb94`, Aug 4) — it is NOT what triggered the Aug 6 onset.** Deciding field:
   compare `greeting_gate_config`'s dumped `VAD_SPEECH_RMS_FALLBACK` against the
   heartbeat's `rms_now` and `thr` — if `rms_now` stays below 0.055 for the whole
   greeting on a run where `thr` (the seeded/calibrated value) would have been well
   below `rms_now`, that's the smoking gun: the gate ignored a threshold it would have
   passed. Also watch `voiced_ticks` — it should stay at/near 0 the whole time on a
   failing run despite the mic clearly being live (background noise floor greens on
   pre-check).
2. **(Open, top candidate per unanimous-independent panel ranking) Greeting-startup
   audio graph/source-node lifecycle issue around `22179a2`** (corrected from `083eb8c`
   on the task-898 refire — see §2.3.1; `22179a2` is the real code commit, `083eb8c` is
   its 2-minutes-later HANDOFF.md paperwork commit, same underlying change) — the
   cold-start `AudioContext.resume()` guard added to `renderGreeting()`, 2026-08-06 08:49
   UTC — the only audio-path commit between the last Mac pass and the first iPhone-silent
   run) — most likely the source node is created/used before the context is truly
   `running` or before the track is live, and `287df38`'s later "single cached source
   per context" fix may have pinned a bad source for the session rather than fixing the
   ordering. **Sharpest supporting clue: Rob's own 16-Aug session shows healthy
   preflight speech (0.051) collapsing to 0.005-0.009 by the time the greeting starts,
   within the SAME session** — argues for a phase-transition bug, not a generally bad
   mic/room. Deciding fields (new in this sensor pass): `audio_graph_timing`'s source-
   creation / resume-call / resume-resolved timestamps relative to recording start, plus
   the heartbeat's `ctx_state` — if `ctx_state` is not stably `running` from the first
   greeting heartbeat, or the source was created before resume resolved, that's the
   confirmation. Also compare `seed_provenance`'s `stream_id`/`track_id` (preflight)
   against the greeting-phase source identity once surfaced.
3. **(Open, secondary per panel) AGC/voice-processing compression as the observed
   signal shape** (not necessarily the trigger) — 0.005-0.009 with intact voice-band
   spectral content matches task-722's documented "iOS AGC compresses mic RMS to ~1%".
   Deciding field: `vb_ratio` moving with speech while `rms_now`/`rms_max` stay flat and
   low — if `vb_ratio` is clearly speech-correlated during the failing greeting, the
   signal is present but compressed, favoring "greeting gate policy problem on top of
   compression" over "totally dead analyser."
4. **(Open, added on the task-898 refire — do NOT treat as ruled out)** `8418de3`
   (task-voice-content-gate, 2026-08-06 04:16 UTC): rewrote `_phraseVadTick` so
   `_phraseHeardVoice` was set only by a matched SpeechRecognition transcript when
   `_contentGateAvail`, with no timeout — a direct, unconditional stall independent of
   the RMS-threshold issue in #1. **The prior pass (task 890) ruled out "S155/content-gate
   changes" on this branch, but that verdict was reached without ever seeing `8418de3`'s
   diff — the shallow clone in that environment made it appear not to exist (§0.1), so
   only `9c248c4` (a later hardening pass on the same lineage, correctly not implicated)
   got analyzed.** S164 (`36e7c6d`) removed the content-*match requirement*, which should
   have closed this specific stall — but the content gate still starts and runs for the
   whole `PHRASE_DURATION` in parallel with the analyser, and per the existing
   `CEREMONY-GREETING-DIAGNOSIS-S161.md` doc it "opens its OWN capture." If that capture
   is contending with/ducking the analyser's track, S164 wouldn't have fixed that half of
   it (see §4). Deciding field: `seed_provenance`'s `stream_id`/`track_id` compared
   against whatever identity the content gate's own capture uses, plus whether
   `phrase_content_gate_matched`/`phrase_gate_dead_escape`/`phrase_content_gate_nomatch_escape`
   appear at all in the 40 failing sessions (their total absence would mean ticks never
   accumulated far enough for the content-gate logic to matter either way, pointing back
   to #1 as sufficient on its own).

**What Rob should look for in his next run's trace:** the new `greeting_gate_config`
line at arm (constants in force), then the 2s heartbeats — specifically (a) whether
`rms_now` ever exceeds `thr` (the seeded value) while `voiced_ticks` stays flat [→ #1],
(b) whether `ctx_state` is `running` from the very first heartbeat and whether
`audio_graph_timing` shows the source created before resume resolved [→ #2], (c)
whether `level_source` ever flips from `analyser` to `mr` (starvation fallback engaging)
before the run ends, (d) whether `vb_ratio` tracks speech even while `rms_now` stays
low [→ #3], and (e) whether `seed_provenance`'s `stream_id`/`track_id` for the greeting
phase match the preflight's, and whether any `phrase_content_gate_*`/`phrase_gate_dead_escape`
events fire at all during the failing attempt [→ #4]. Also worth a one-time pull (no new
sensor needed) of `mic_ready_wait_start`/`mic_ready_ctx_running`/`mic_ready_done`/
`mic_ready_timeout` from existing telemetry if any of the 40 failing sessions are
quick-auth reauth runs (§2.3.1) — free signal on whether the fast tier has a related
problem, though it doesn't gate the full ceremony path itself.

**Full model responses, cost/latency, and job IDs are in this repo's job history via
`GET /v1/orchestrate/job/{id}` for `orchestrate_20260816_062337_027711_ffaa0fa6`
(defect repro), `orchestrate_20260816_062408_257087_9172472d` (2nd defect: dropped
context field), and `orchestrate_20260816_062531_037754_0be84c28` (working 3-model
review, $0.32, 212s) — not re-pasted here in full to keep this doc readable.**

## Appendix: environment note (unrelated to the diagnosis, flagged for hygiene)

`RAILWAY_GIT_COMMIT_MESSAGE` in this container's environment contains a multi-line
commit message from an unrelated task (task-881, "GATES+MERGE record for
task-repo-infer-strip-emails") rather than this task's context. Benign (looks like
stale/leftover platform metadata from the deploy that provisioned this worker, not an
injected instruction — it doesn't direct any action), but noting it in case it's a sign
of container reuse/state bleed worth checking on the platform side.
