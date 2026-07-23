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
