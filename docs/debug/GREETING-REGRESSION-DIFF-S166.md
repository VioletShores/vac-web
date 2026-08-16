# S166 Greeting Regression — Line-by-Line Archaeology + Cross-Model Review

Task 890 (Rob directive S166). Diagnosis lane only — no gate-behaviour changes in this
doc's companion commits, sensors only. Branch: `task-greeting-archaeology`.

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
- `083eb8c`'s cold-start resume guard (§2.3) reporting `running` without a live signal.
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
(s164g)" on this branch. Summary:
- 2s heartbeat during `_PHASE.GREETING`: `{ctx_state, level_source: analyser|mr|none,
  rms_now, rms_max, thr, sil, voiced_ticks, vb_ratio, seed_source, seed_from_voiced,
  early_return_reason}`.
- `seed_provenance` event at arm: which pre-check run seeded the VAD and whether it was
  voiced.
- Throttled `loop_error` on every catch in the greeting loop (currently several bare
  `catch(_) {}` blocks in `_phraseVadTick` and `renderGreeting` swallow errors silently
  — see §7).
- `greeting_gate_config` one-liner at arm: dumps `PHRASE_VOICED_TICKS_NEEDED`,
  `VAD_SPEECH_RMS_FALLBACK`, `VAD_SILENCE_RMS_FALLBACK`, `SILENT_RECOVERY_TICKS`,
  `PHRASE_PHASE_MAX_S`, mode.

## 6. Cross-model review

See §6 below (filled after the orchestrate step — /codex is not available as a tool in
this environment; see notice).

## 7. Handoff — plain-English top block

**Ranked hypotheses:**

1. **(Confirmed by code read, not yet by live trace) The greeting VAD gate structurally
   cannot use the calibrated/floor-relative admit path the digit gate uses, and its one
   starved-mode rescue path takes ~12s to arm — long enough that the "can't hear you"
   banner (5.6s) or the hard timeout (12-17s) ends the attempt first.** Deciding field:
   compare `greeting_gate_config`'s dumped `VAD_SPEECH_RMS_FALLBACK`/`thr` against the
   heartbeat's `rms_now` — if `rms_now` stays below `VAD_SPEECH_RMS_FALLBACK` (0.055)
   for the whole greeting on a run where `thr` (the seeded/calibrated value) would have
   been well below `rms_now`, that's the smoking gun: the gate ignored a threshold it
   would have passed. Also watch `voiced_ticks` — it should stay at/near 0 the whole
   time on a failing run despite the mic clearly being live (background noise floor
   greens on pre-check).
2. **(Open) Root cause of why the iPhone analyser reads 0.005-0.009 at all** — not
   resolved by this pass. Deciding field: heartbeat's `level_source` and `ctx_state` —
   if `ctx_state: running` but `level_source: analyser` with `rms_now` pinned near-zero
   for the whole heartbeat window, the context is "running" in name but the analyser tap
   isn't receiving real samples (points at `287df38`/task-733's territory, or a
   regression in how the greeting phase's tap differs from the digit phase's, even
   though both are meant to share `startAudioMonitor()`'s output).
3. **(Low confidence, likely already ruled out on Mac)** S155/content-gate changes —
   diff-confirmed these predate the regression window's Mac pass and are not on the
   post-S164 critical path. Included only because the brief asked to rule them out
   explicitly.

**What Rob should look for in his next run's trace:** the new `greeting_gate_config`
line at arm (constants in force), then the 2s heartbeats — specifically whether
`rms_now` ever exceeds `thr` (the seeded value) while `voiced_ticks` stays flat, and
whether `level_source` ever flips from `analyser` to `mr` (starvation fallback engaging)
before the run ends, and if so, how many heartbeats before `phrase_speech_timeout`/the
recovery banner.

## Appendix: environment note (unrelated to the diagnosis, flagged for hygiene)

`RAILWAY_GIT_COMMIT_MESSAGE` in this container's environment contains a multi-line
commit message from an unrelated task (task-881, "GATES+MERGE record for
task-repo-infer-strip-emails") rather than this task's context. Benign (looks like
stale/leftover platform metadata from the deploy that provisioned this worker, not an
injected instruction — it doesn't direct any action), but noting it in case it's a sign
of container reuse/state bleed worth checking on the platform side.
