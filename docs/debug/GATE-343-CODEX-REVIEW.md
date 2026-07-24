# GATE 343 — adversarial review of task-329-preflight vs origin/main

Reviewer: Athena gate lane (codex-style adversarial read), 2026-07-24
Base: origin/main @ 3629716 (2026-07-23 20:41 UTC)
Head: task-329-preflight @ c50d6d4 (2026-07-24 06:37 +10)
Diff scope: 1 file, `vac-reauth-ceremony.js`, +202/-16, 6 commits (edc9518, 77ba602, d2dbe0b, c891b22, e7f71a4, c50d6d4)

**No unrelated changes.** Every hunk carries an S145/T-329/THIN-329 comment tag and maps to one of the
six documented findings in `docs/debug/S145-PREFLIGHT-INTEGRITY-FINDINGS.md` (findings 1–6 — note: the
lane brief says "five findings" but the doc has six, and this branch's six commits map 1:1 to all six,
not five; not a blocker, just flag it so Rob's device-test checklist covers all six, not five).

**No server-side / auth-verdict surface touched.** Everything here lives in the client-side AV
pre-flight (hand/mic/light pills, skeleton overlay) or the fast-tier's own client pre-gate UI. The
comments are correct that the server still recomputes `hand_near_face` and is the authoritative
decision-maker; none of these six commits touch what gets POSTed or how a server verdict is rendered.
So there's no weakening of the actual auth-ready gate here — the risk is entirely "the advisory UI
still lies to the user/Rob in the same way the findings reported," which is exactly what a gate review
should catch.

## Verdict: CHANGES REQUESTED — do not merge as-is

Three of the six fixes have a real gap that lets the ORIGINAL reported symptom recur under plausible
conditions. None are security regressions (nothing server-facing changed), but two of them (findings 2
and 4) are the two the restaurant test called "security-significant" / most damaging, so I don't think
this closes the loop Friday's board says it closes. Findings 1, 3, and 6 look solid on read-through.

---

## Finding-by-finding

### Finding 1 (T-329a, hand-latch regression) — LOOKS CORRECT
`_near` (the real `_handNearFaceZone` gate) is computed unconditionally every frame at the top of the
hand block regardless of `avChecks.hand`, including the `lm === null` (no hand at all) case, so a
dropped/phantom hand correctly starts incrementing `_handUnstableFrames` and regresses the ✓ after 10
consecutive frames. This is the fix the "All set" phantom-hand finding needed. No issue found.

### Finding 2 (T-329c, ambient-relative mic pill) — BUG: reintroduces the exact false-positive under continuous ambient noise
`vac-reauth-ceremony.js` ~line 700:
```js
const _ambient = _micLevelHistory.filter(e => e.t < _micRunStartT).map(e => e.level).sort(...);
const _ambientMedian = _ambient.length ? _ambient[Math.floor(_ambient.length/2)] : 0;
...
if (_runMedian > 2 * _ambientMedian) { ... qualify ... }
```
When there is no history *preceding* the run (`_ambient` is empty), `_ambientMedian` defaults to `0`,
and `_runMedian > 0` is true for essentially any speech-or-noise burst ≥ 12%. That's not a rare edge
case — it's the restaurant scenario itself: if ambient is *continuously* above 12% from the moment the
AV check starts (a noisy restaurant, per the report), `_micLoudFrames` hits 3 within the first ~3 frames
of the whole check, before any pre-run "quiet" baseline has had a chance to accumulate in
`_micLevelHistory`. At that instant `_ambient` is empty → `_ambientMedian = 0` → the pill ticks "Mic:
working ✓" off ambient alone, which is verbatim the bug Finding 2 reports ("ambient crossed the
absolute bar and the ✓ stuck").

This also reproduces on every retry: `retryAVSetup()` wipes `_micLevelHistory = []` along with the other
mic state, so a user who hits Retry in a loud room re-triggers the same zero-history window each time.

Fix direction: don't let an empty/under-sized ambient sample act as "ambient = silent" — either require
a minimum ambient sample size (e.g., ≥ 500ms / N frames of history) before a run can qualify at all, or
treat "no ambient baseline yet" as "can't compare, don't tick" rather than "ambient is 0."

### Finding 3 (THIN-329b, landmark draw stability gate) — LOOKS CORRECT
Requiring 4 consecutive frames of complete + wrist-plausible landmarks before drawing anything, with any
single bad frame zeroing both the active and challenger streaks, is a sound gate against the reported
frame-to-frame jitter. No issue found in isolation (see Finding 4 below for how this interacts badly with
the candidate-selection logic layered on top of it).

### Finding 4 (THIN-329d, candidate-aware streak selection) — BUG: incumbent streak is unbounded and never decays, so a real hand can take arbitrarily long (or effectively forever) to displace a long-lived phantom
```js
if (_avActiveWrist && _avDist(_avActiveWrist, _avWrist) < _AV_CANDIDATE_DIST) {
    _avActiveWrist = _avWrist; _avActiveStreak++;           // grows without bound, every matching frame
    ...
} else if (_avChallengerWrist && _avDist(_avChallengerWrist, _avWrist) < _AV_CANDIDATE_DIST) {
    _avChallengerWrist = _avWrist; _avChallengerStreak++;
    if (_avChallengerStreak >= _avActiveStreak) { /* promote */ }
```
`_avActiveStreak` has no cap and no decay — it only resets to 0 on a fully-invalid frame (missing
landmarks / implausible wrist), never just because the incumbent candidate stopped reappearing. `runAVFrame`
runs on `requestAnimationFrame` (~60fps), so a phantom present from the moment the AV check screen opens
can rack up a triple/quadruple-digit streak within a few seconds — before the user has even raised their
hand. Per the fix's own comment, "a challenger must build a streak >= the incumbent's before it takes
over," which means the real hand then needs that same number of *consecutive, uninterrupted* frames to
win the draw. Two compounding problems:
1. The bar to clear scales with how long the phantom got a head start, which in the restaurant case
   (constant visual clutter) could be from the instant the camera opens — i.e., several seconds' worth
   of frames before the user's hand is even in frame.
2. The challenger's progress resets to 0 on ANY frame that doesn't match it — including a stray
   re-appearance of the very phantom it's trying to displace. Given the findings doc explicitly
   describes phantoms as jittering/flickering rather than steady, an intermittent phantom re-flicker
   mid-attempt keeps zeroing the real hand's progress, so it may never catch up.
3. There's no decay for a phantom that stops appearing entirely (e.g., lighting changes) — its frozen
   streak value keeps acting as the bar for a brand-new real-hand challenger indefinitely, until some
   unrelated fully-invalid frame happens to reset both slots to zero.

Net effect: this is very plausibly still "the real hand loses to the hallucination" in the field, just
with extra bookkeeping — the exact symptom Finding 4 was supposed to close. Suggest capping the
comparison (e.g., challenger only needs to match a small fixed floor like the same "4 consecutive frames"
draw threshold, not the incumbent's full accumulated count) and/or decaying the incumbent's streak based
on recency-since-last-seen rather than treating it as permanent.

### Finding 5 (THIN-340, quick-auth mic pill wiring) — BUG: `#vacStepVU` / `__vacGateArmed` are armed but never disarmed for the fast-tier gate, leaking a stuck floating meter onto whatever screen comes next
```js
window.__vacGateArmed = true; _micPillDraw(rms, speechThr, 'q');
```
is the only place in `_makeQuickReauthVoiceGate`'s loop that touches these globals. Every OTHER call site
that arms `__vacGateArmed` / creates `#vacStepVU` has a matching disarm: line ~2419 explicitly does
`window.__vacGateArmed = false` + removes `#vacStepVU` + resets `#avMicBarFill` at its gate-off point, and
the `runAVFrame` loop (line ~636) removes `#vacStepVU` on every frame where `__vacGateArmed` is false —
but that cleanup only runs while the AV pre-flight's own `requestAnimationFrame` loop is alive, which
`stopAVChecks()` cancels once the fast tier moves from pre-flight into the capture step. From that point,
nothing ever runs the removal check again for this flow.
`_voiceGate.stop()` (called at capture end, success or fail) only clears its own internal `_raf`/`_armed`
state — it never touches `window.__vacGateArmed` or removes `#vacStepVU`. So once the fast digit gate
fires at least once, `#vacStepVU` (an absolutely-positioned overlay anchored to `#videoPreview`'s parent,
or `position:fixed` at `z-index:99999` if there's no video host) is created and then never removed: it
persists through `renderQuickReauthVerdict` / `renderClientGateFailure` and beyond. Worth noting this
would visually sit on top of Finding 6's new evidence card too — a stray VU meter left floating over the
"here's what this device saw" screen undercuts the clarity Finding 6 is trying to add.
Fix direction: mirror the existing gate-off pattern — when `beginStillCapture` reaches its terminal
states (verdict render, client-gate-fail-close render, or any other return path), also set
`window.__vacGateArmed = false` and remove `#vacStepVU` (and reset `#avMicBarFill` if present), the same
way the line-2419 site does.

### Finding 6 (client-gate fail-close evidence) — LOOKS CORRECT
Evidence is collected per-attempt inside the existing bounded finger-retry loop (not unbounded — the loop
already breaks via `_FINGER_MAX_RETRY` / detector-down independent of this change), pushed *before* the
fail-close decision so a later-failing retry still keeps earlier attempts' evidence. `expected_count` is
the already-displayed challenge digit and `zone_in` is a boolean, not raw landmark data, so the
"security-safe, no new surface" claim in the comment holds up. `renderClientGateFailure` correctly reuses
the same document-global host pattern the rest of step3 uses (intentional per the existing F-671 Phase B1
comment on this file), and snapshots `__qrOrigHTML` only if not already set, consistent with the existing
`_pc0.__qrOrigHTML` restore pattern elsewhere in this function. No issue found (aside from the Finding 5
DOM-leak interaction noted above, which is Finding 5's bug, not this one's).

---

## Summary for the gate

- Findings 1, 3, 6: solid, ready.
- Finding 2: has a real gap — continuous/from-the-start ambient noise (the restaurant case) can still
  falsely tick "Mic: working ✓" because the ambient-comparison median defaults to 0 with no prior
  history. Needs a minimum-sample guard before this is safe to call "fixed."
- Finding 4: has a real gap — the incumbent-streak-must-be-matched design has no cap or decay, so a
  long-lived or intermittently-recurring phantom can keep a real, raised hand from ever winning the draw
  in realistic timeframes. This is arguably still open, not closed.
- Finding 5: introduces a new, narrow bug (unbounded stuck DOM overlay) as a side effect of the fix —
  contained to a visual leak, not a security or verdict issue, but should be closed before this ships
  since it directly clutters the Finding 6 evidence screen it's paired with in this same branch.

Recommend: patch findings 2, 4, 5 on this branch (or a thin follow-up) before Rob's device re-test, since
the restaurant scenario is precisely what all three would need to hold up against. Not merging — per
lane instructions this stays a review-only gate.

---

## RE-GATE 352 — 2026-07-24, task-329-preflight @ c3acb39

Reviewer: Athena gate lane (adversarial re-read), 2026-07-24
Scope: ONLY the three finisher commits below, re-checked against Findings 2, 4, 5 above.
Diff: `vac-reauth-ceremony.js`, e73e650 (f2), 6686f62 (f4), c3acb39 (f5), on top of c50d6d4 (the head
this GATE-343 review was originally run against).

### Finding 2 (T-329c, ambient-relative mic pill) — e73e650 — **CLEAR** (recurrence path closed), flag below is availability, not a blocker

The documented exploit was: no pre-run history → `_ambientMedian` defaults to `0` → any ≥12% burst in
the first 3 frames qualifies. e73e650 closes exactly that hole: qualification is now withheld until
`_micSeeded` is true (`if (_micLoudFrames >= 3 && _micSeeded)`, line 697), which can't happen before a
real 1.5s sample (`_micSeedLevels`) has been measured and medianed into `_micSeededAmbient` (lines
678-684). The qualifying floor is then `Math.max(2 * _ambientMedian, 2 * _micSeededAmbient, 12)` (line
711) — so a ceremony that starts in continuous ambient noise gets that noise folded into the seeded
floor instead of comparing against a bogus zero, and the pre-existing absolute 12% floor still guards a
genuinely-quiet seed. Retry is covered too: `retryAVSetup()` re-invokes `startAVChecks()` (line 1623),
which resets `_micSeedLevels/_micSeedStartT/_micSeededAmbient/_micSeeded` (lines 552-555), so every retry
gets its own fresh seed window rather than reusing a stale one. No path found where a run can still
qualify against an unmeasured (zero) baseline. Verdict: **CLEAR** on the documented recurrence.

**Flag (per task instruction — availability nuance, not a block):** the 1.5s seed window is not gated on
user silence, and the product copy actively invites speech into that exact window. The static
`avMicPromptText` markup ("Speak now to test your microphone", line 5230) is visible from the moment the
pre-flight screen renders, `retryAVSetup()` sets the identical string (line 1614) immediately before
re-arming a fresh seed window, and the sequential-gate guide text shows "Step 2 of N — say a few words to
test your microphone" (line 1546) for as long as `avChecks.mic` is false — i.e., for the entire seed
window and beyond. If the user complies (or is already mid-conversation — literally the restaurant case
this gate exists for) during that first 1.5s, their own voice, not just room noise, gets folded into
`_micSeededAmbient` via the median. Because the qualifying floor is `2× seeded ambient`, a user whose
later genuine speech (answering the actual prompt) lands near the same RMS as their seed-window "testing"
utterance would need to speak roughly twice as loud as their own baseline to ever tick Mic✓. `avChecks.mic`
gates `allGood` (line 1558) on the full (non-fast) path, so in the worst case this stalls a legitimate
user at "Mic: checking" rather than falsely passing a fake one — the inverse failure mode of the original
bug, and non-blocking per the task's framing, but worth tracking: e.g. use a low percentile instead of
median for the seed sample (so a brief compliant utterance doesn't dominate it), or hold the "speak now"
copy until after the seed window closes.

### Finding 4 (THIN-329d, candidate-aware streak selection) — 6686f62 — **CHANGES-REQUESTED**: bounds the growth, but the single-challenger-slot eviction path (the original finding's compounding problem #2) is untouched and can still stall a real hand against an actively-jittering phantom

`_AV_INCUMBENT_STREAK_CAP = 12` (line 1049) plus decay-by-1 on invalid frames (lines 1091-1096,
1112-1117) genuinely closes the "arbitrarily long / effectively forever" framing for a single STEADY
phantom: the incumbent can no longer accrue an unbounded, practically-unbeatable streak, and the
challenger now only needs to strictly exceed a capped value (line 1126), so a real hand needs ~13
uninterrupted frames (~0.2s at 60fps) in the worst case instead of racing an ever-growing number. That is
a real, substantial fix for problems #1 and #3 as originally written.

However, decay only fires on a *fully-invalid* frame (no landmarks / failed wrist-plausibility). A frame
where a *different, valid* detection appears elsewhere — exactly what a "jittering/flickering" phantom
produces, per the findings doc's own description of the failure mode — does not decay the incumbent at
all. It's routed through the unchanged `else` branch (lines 1130-1133):
```js
} else if (!_avActiveWrist) {
    _avActiveWrist = _avWrist; _avActiveStreak = 1;
} else {
    _avChallengerWrist = _avWrist; _avChallengerStreak = 1;
}
```
This unconditionally overwrites the single challenger slot and resets its streak to 1 whenever a new,
unrecognized position shows up — including a flickering phantom re-entering frame at a slightly different
spot than either the incumbent or the current challenger. Since there is only one challenger slot, a
phantom that keeps reappearing at new positions (rather than the same one) keeps evicting the real hand's
accumulated progress back to 1 before it can ever exceed the (now merely 12-capped, but still nonzero)
incumbent — the same recurrence shape as the original finding's problem #2 ("an intermittent phantom
re-flicker mid-attempt keeps zeroing the real hand's progress"), just now bounded in magnitude rather than
closed. This code path received no changes in 6686f62.

Net: a real improvement (unbounded → bounded, `>=` → `>`), and likely sufficient for the single-steady-
phantom case the commit message targets, but does not close the documented recurrence for an actively
jittering phantom, which is the specific shape the findings doc uses to describe the restaurant/clutter
case. Suggest either giving the challenger slot the same grace/decay treatment (don't hard-overwrite it
on every new stray position) or tracking more than one challenger candidate.

### Finding 5 (THIN-340, quick-auth mic pill wiring) — c3acb39 — **CLEAR**

The new teardown (`window.__vacGateArmed = false` + `#vacStepVU` removal, lines 3877-3882) sits
immediately after `_voiceGate.stop()` inside `beginStillCapture`, which is the single point every exit
path passes through: traced all branches below it (finger client-gate fail-close at line 3900, embedding
fail-close at line 3927, and the `runFastVerification` success/deny path at line 3932) and confirmed none
of them can be reached without first executing this teardown — there is no early `return` between where
`_voiceGate` is armed (`_makeQuickReauthVoiceGate` at line 3599, the only call site of that function) and
the new disarm line. `#vacStepVU` uses a global DOM id and is appended to either the video-host parent or
`document.body` (lines 2192-2204), so the `document.getElementById('vacStepVU')` lookup in the new
teardown finds it regardless of the fast tier's mount-scoping — mirrors the existing line-2461 disarm
pattern exactly, including the same `try/catch` shape. No new regression found; the fix closes the
documented DOM-leak recurrence.

### RE-GATE summary

- Finding 2 (e73e650): **CLEAR** — closes the documented exploit. One availability flag noted (seed
  window is speech-invited by the app's own copy, can inflate the floor against the user) — track, don't
  block.
- Finding 4 (6686f62): **CHANGES-REQUESTED** — caps/decays the incumbent, which closes the single-steady-
  phantom version of the bug, but the untouched single-challenger-slot eviction path (lines 1130-1133)
  leaves the jittering-phantom recurrence open, just bounded now instead of unbounded.
- Finding 5 (c3acb39): **CLEAR** — teardown chokepoint verified against every exit path; no new
  regression.

Not merging — per lane instructions this stays a review-only gate. DO NOT MERGE.
