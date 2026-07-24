# GATE 344 — CSO review of task-329-preflight vs origin/main (auth trust surface)

Reviewer: Athena gate lane (Chief-Security-Officer read), 2026-07-24
Base: origin/main @ 3629716
Head: task-329-preflight @ c50d6d4 (the code commit; 691eee2 on top is docs-only, GATE-343's own review file)
Diff scope: 1 file, `vac-reauth-ceremony.js`, +218/-16, 6 commits (T-329a/THIN-329b/T-329c/THIN-329d/THIN-340/S145-finding-6)
Companion doc: `docs/debug/GATE-343-CODEX-REVIEW.md` (engineering/adversarial pass on the same diff, done first). This
review re-reads the same six commits through a security lens against the four specific questions in the lane
brief, and does not re-litigate what 343 already covered — it cites 343 where the two overlap and adds what 343
didn't check.

## Verdict: CONCERNS — not a blocker for the advisory UI's own scope, but two of the four questions come back
with real gaps. Nothing here reaches the server-side auth verdict (confirmed below), so this is not an
auth-bypass finding, but Q4's ambient-ratio gate is a genuine availability/denial risk for legitimate users
that the branch does not tune or instrument, and Q3's VU hook has a leftover-state bug that can visually
collide with Q2's new evidence UI.

## Structural framing (load-bearing for every question below)

`avChecks.{light,mic,hand}` and the fast-tier's `_fastDetectorReady` gate exactly one thing: whether the
**"Start verification" button is enabled** (`updateAVReady`, line ~1516: `allGood = avChecks.light && avChecks.mic
&& (fastStill ? _fastDetectorReady : avChecks.hand)`). None of these three pre-flight pills, nor the fast-tier's
own in-capture VAD (`_makeQuickReauthVoiceGate`), are inputs to the actual accept/reject decision:
- Hand: the file's own comment (line 473-474, pre-existing) states the client zone check is "a PROXY for the
  server's hand_near_face anti-spoof gate, used ONLY to give the user live feedback — the server still
  recomputes hand_near_face." Confirmed nothing in this diff changes what gets POSTed.
- Mic (pre-flight pill): confirmed to have zero linkage to the real in-challenge/in-capture VAD state
  machines (`_makeQuickReauthVoiceGate` for fast, the digit-loop VAD for full) — those run their own
  independent `rms`/`speechThr`/`silenceThr` comparisons, untouched by `avChecks.mic`.

So: nothing in this branch can trick the server into accepting a verification it shouldn't. The exposure is
entirely (a) can the pre-flight UI mislead the user/Rob about readiness, and (b) can it **deny** a legitimate
user from ever reaching Start. That reframes "spoofed or falsely latched" for this diff as a UX-integrity /
availability question, not an auth-bypass question — which is exactly where the two real findings below land.

---

## Q1 — Can the hand-ready / mic-ready gates be spoofed or falsely latched post-fix?

**Hand-ready (`avChecks.hand`): no new spoof path.** The readiness latch (line ~797: `_ckFin && _near`,
5 consecutive frames, `_near` recomputed every frame per T-329a) is fully independent of the candidate-selection
streak logic (`_avActiveWrist`/`_avActiveStreak`) that GATE-343 flagged as broken (Finding 4). I traced both: the
candidate-streak code lives only inside `_avDrawHand` and gates what gets **drawn** on the skeleton overlay
canvas — it never writes to `avChecks.hand`. So GATE-343's Finding 4 bug (unbounded incumbent streak, a phantom
can indefinitely block the real hand from being *drawn*) is a real UX/display defect but **does not** let a
phantom falsely latch the actual readiness gate or the Start button. Worth correcting in the record: 343's
writeup doesn't make this distinction explicit and could be read as a gating bug — it isn't one.
I also checked `retryAVSetup()` for leftover-state re-latch risk (the obvious place a stale counter could let a
phantom re-arm the ✓ in 1 frame instead of 5): `retryAVSetup()` calls `startAVChecks()` on stream re-acquire,
which resets both `_handStableFrames` and `_handUnstableFrames` to 0 (line ~539-548). No gap there.

**Mic-ready (`avChecks.mic`): confirmed false-latch, matches GATE-343 Finding 2, with one addition.**
`_ambientMedian` defaults to `0` when `_micLevelHistory` has no pre-run samples (session start, or immediately
after `retryAVSetup()` wipes `_micLevelHistory = []`), so `_runMedian > 2 * _ambientMedian` is satisfied by
essentially any burst ≥ 12%, independent of whether it was the user's speech or standing ambient noise. This
reproduces the exact symptom the fix was meant to close. See GATE-343 for the full trace — confirmed correct on
independent re-read.

---

## Q2 — Does the failure-evidence rendering (`renderClientGateFailure`, S145 finding 6) leak anything beyond the
in-session challenge?

**No leak found — CLEAR.** Traced every field that reaches the DOM:
- `expected_count` — the digit the challenge already displayed on-screen to this same user this session.
- `detected_finger_count` — an integer (or null/-1), the user's own hand, already visible to them via their
  own camera; never a raw landmark array or image.
- `zone_in` — a boolean (`_handNearFaceZone(_evLm)`), not coordinates.
- `attempt_n` — a small integer.
- `reason` — mapped through a fixed friendly-string switch (`_reasonMsg`); the internal reason codes
  (`finger_detector_down`, `no_finger_after_retry`, etc.) are never shown raw, and unrecognized codes fall to a
  generic message — no internal-state leak via an unmapped string reaching the DOM.
`_gateEvidence` is a function-scoped local array (`beginStillCapture`, line ~3499): confirmed by grep it is
never passed to `vacDebug()`/telemetry and never leaves the client — it is read exactly once, by
`renderClientGateFailure` itself, to build the DOM the current user is already looking at. No injection risk
either: all interpolated values are numbers/booleans coerced to fixed strings, no untrusted string concatenation
into `innerHTML`. Matches GATE-343's "no new security surface" read; independently confirmed.

---

## Q3 — Does the quick-auth VU hook (THIN-340, `_makeQuickReauthVoiceGate`) alter gate logic?

**No — confirmed the hook is display-only, does not touch the accept/reject decision.** The added line
(`window.__vacGateArmed = true; _micPillDraw(rms, speechThr, 'q');`, line ~3393) sits inside the existing
`_loop` closure but before/alongside the untouched `rms < silenceThr` / `rms > speechThr` branching that drives
`voiced`/onset/sustain state — nothing about that state machine changed. Diffed the whole function body against
main: the only insertion is the one line above.

**But it does have a real cleanup bug (matches GATE-343 Finding 5), which I'd flag as security-relevant here for
a different reason than 343 did.** `stop()` on the object `_makeQuickReauthVoiceGate` returns (line ~3459: `stop:
function(){ _stopped = true; ... }`) never clears `window.__vacGateArmed` or removes `#vacStepVU`. The only
disarm site in the entire file is line 2419, which belongs to the full/clip ceremony's teardown path, not
anything reachable from `beginStillCapture` (the fast-tier path this hook lives in). Grepped every
`__vacGateArmed` write/read site to confirm — line 2419 is genuinely the only reset. Net effect: once the fast
digit gate fires once, `#vacStepVU` (an absolutely/fixed-positioned, z-index:99999 overlay) is created and never
removed for the rest of that fast-tier session.
Why this matters for a CSO gate specifically: this stuck overlay sits in the same DOM region
`renderClientGateFailure` (Q2) renders into on a client-side fail-close. A floating VU meter overlapping the
"here's exactly what this device saw" evidence card undermines the transparency that evidence card exists to
provide — it's not a data leak, but it is a trust-surface / auditability regression, and it ships in the same
branch as the evidence feature it can visually obscure. Recommend closing this before merge, same fix direction
as 343: disarm + remove `#vacStepVU` at every terminal path of `beginStillCapture` (verdict render, client-gate
fail-close render, and the plain `onFallback` return with no evidence host).

---

## Q4 — Does voice-band gating (T-329c ambient-relative mic ratio) create a denial vector for legitimate
quiet/deep voices? Is the ratio floor tunable, and is it surfaced to QA?

**Yes — this is the sharpest finding in this review, and it's the flip side of Q1/Finding 2.** Finding 2 (Q1)
is the false-positive direction (ambient noise alone ticks the pill). The same `2 * _ambientMedian` ratio also
has a false-negative / lockout direction that nobody has evaluated: a legitimately quiet-spoken or soft-voiced
user in a room with **moderate** (not extreme) ambient noise must produce a sustained run whose median RMS
clears **2x** whatever the ambient median is. In a quiet room this is a low bar (ambient ≈ near-zero). In a
moderately noisy but non-restaurant environment (café/office ambient, say 8-15%), a naturally quiet speaker
needs to sustain 16-30%+ — a level some legitimate users (soft speakers, older adults, people asked not to raise
their voice in a shared space, anyone deliberately speaking quietly for privacy) may simply not produce.

I checked whether there's a fallback or timeout that lets a user past this if the pill never ticks:
**there isn't one.** `updateAVReady()` (line ~1516) requires `avChecks.mic === true` unconditionally to enable
"Start verification" — there is no elapsed-time bypass, only progressive *tips* at 3s/8s ("try speaking louder
or clapping", "check your browser permissions") via `updateMicTips()`. A user whose voice never clears the
ratio is **stuck on the pre-flight screen indefinitely**, not just inconvenienced. For a re-auth flow that's
supposed to be the *fast* path, this is a real availability regression for exactly the class of legitimate user
Rob asked about — not a hypothetical edge case, since ambient level is genuinely bimodal in real deployment
environments (the S145 test matrix itself: quiet / noisy-audio / busy-visual).

**Tunable? No.** The `2` is an inline literal at the comparison site (`if (_runMedian > 2 * _ambientMedian)`),
not a named constant. Every other VAD-adjacent threshold in this file follows a documented-constant convention
— `VAD_SPEECH_RMS_FALLBACK`, `VAD_VOICE_BAND_FRAC`, `DIGIT_VOICE_GAP_MS`, `FAST_VAD_VOICE_BAND_FRAC`, etc. are
all named, top-of-scope constants with an explanatory tuning comment (several explicitly marked "S145 live-tune"
from Rob's own device testing). The ambient ratio breaks that pattern: it can't be adjusted without editing the
comparison expression in place, and there's no equivalent of the `VAD_SPEECH_RMS_FALLBACK` comment trail
documenting what value was tried and why.

**Surfaced to QA? No.** Grepped for any `vacDebug(...)` or `QA.on`/`QA.frame(...)` reference near
`_ambientMedian`/`_runMedian` (lines 679-682): none exists. Contrast with the digit-capture VAD path a few
hundred lines down, which has both `vacDebug('vad_calibrated', {floor, speech, thr, sil, ...})` (line ~3013) and
a `_lastRejectReason` value ('spec' | 'sust') that is explicitly "surfaced in the QA debug readout" (line 2239,
rendered behind `QA.on` at line ~2569-2576) and per-frame `QA.frame({rms, thr, ...})` telemetry (line ~2720).
The pre-flight ambient-ratio mic gate has none of this — Rob has no way, even with `?qa=1`, to see what
`_ambientMedian`/`_runMedian` were computing in the field, so a report of "mic never ticks for me" would be
undebuggable from telemetry alone; it would require re-instrumenting first.

**Recommendation:** before this ships, (1) name the ratio as a tunable constant (e.g.
`MIC_AMBIENT_RATIO_FLOOR = 2`) with the same tuning-comment convention as its neighbors, (2) add a
`vacDebug`/`QA.frame` emission carrying `{ambientMedian, runMedian, ratioFloor}` on every qualify-attempt so a
"legitimate user stuck at Step 2" report is diagnosable the same way the digit-VAD path already is, and (3)
decide, with real quiet-voice data, whether 2x is the right floor or whether it should be lower / paired with an
absolute-level OR (e.g., "ratio met OR absolute level ≥ some floor regardless of ambient") so a genuinely quiet
but audible voice in a moderately noisy room isn't hard-locked out. This is the same code path as Finding 2, so
a fix for one should be designed against both failure directions at once, not sequentially.

---

## Summary for the gate

| # | Question | Finding | Severity |
|---|---|---|---|
| Q1 | hand-ready spoof/latch | No new gap; Finding 4 (candidate streak) is draw-only, doesn't touch the gate. Mic-ready **does** false-latch (Finding 2, confirmed). | Mic: real, advisory-only blast radius |
| Q2 | evidence-rendering leak | Clear — no data beyond what's already on-screen to the user this session, no injection vector. | None |
| Q3 | VU hook alters gate logic | No — display-only. Has an un-disarmed leftover-overlay bug (Finding 5) that can visually collide with Q2's evidence card. | Low — UX/trust-surface, not data |
| Q4 | voice-band ratio denial vector | **Yes** — plausible hard lockout for legitimate quiet/soft voices in moderate ambient noise; no bypass/timeout exists. Ratio floor is a bare non-tunable literal; zero QA/telemetry visibility, unlike every sibling VAD constant in this file. | Real — availability risk, needs data-driven retune before Rob's device test covers this case |

Nothing here reaches the server-side verdict or the real in-challenge VAD — this branch cannot be used to trick
the actual authentication decision. The concerns are: (a) the mic pre-flight pill can mislead in both directions
(false-tick under ambient noise, and plausible permanent lockout for quiet speakers under the same ratio design),
and (b) a leftover-DOM-state bug in the VU hook can undermine the new fail-close evidence UI's own legibility.
Recommend Rob's device-test pass explicitly include a deliberately-quiet/soft-spoken voice case in a
moderate-noise (not silent, not restaurant-extreme) environment — the current three-axis test matrix (quiet /
noisy / busy-visual) doesn't have a cell for "moderate ambient + quiet legitimate speaker," which is exactly
where Q4's gap lives.

Per lane instructions: review only, not merging.
