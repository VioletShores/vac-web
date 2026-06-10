# VAC Web — HANDOFF (Session 17 → Session 18)
> Updated: 15 March 2026 ~4:30pm AEDT

## PAGES STATUS

| Page | Route | Auth | Status |
|------|-------|------|--------|
| Hub | /hub | OTP | ✅ Working |
| Auth | /auth | — | ✅ Working, finger ticks upgraded (#83), MediaPipe detection built |
| Rob's Intel | /my | **Disabled** | ⚠️ Shows blank — auth gate disabled but Safari cache issue |
| Shan's Intel | /shan | **Disabled** | ⚠️ Same issue as /my |
| Dad's Copilot | /dad | **Disabled** | ✅ Working — family dashboard with memory log, shares, Sam's advice |
| Regatta | /regatta | OTP + face | ✅ Working |
| Derm | /derm | OTP + face | ✅ Working |
| Privacy | /privacy | None | ✅ Working |
| About | /about | None | ✅ Working |
| ENGINE | /engine | Admin | ✅ Being upgraded to live worker topology (#101) |

## SESSION 17 CHANGES

### SDK (vac-auth.js)
- `_clearToken()` only removes session token, not user identity
- `_clearAll()` for explicit logout
- Trusted users (1+ vouches) skip face requirement on page navigation
- Default camera speed: 'relaxed'
- Reads ?inviter= and ?inviter_name= URL params for auto-vouch
- Trust status fetched after face re-auth

### Auth (auth.html)
- Finger ticks: 44px green with glow (was 36px)
- Active digit: 56px pulsing purple (was 52px)
- Instruction text: white bold (was faint grey)
- Pulse animation added
- Real-time finger detection via MediaPipe (#83) — built, needs testing

### Dad's Page (athena-dad.html)
- Auth gate DISABLED (content visible immediately)
- Family dashboard: memory log, upcoming reminders, From Sam section, family activity log
- Share portfolio: BHP, CBA, Telstra with values, dividends, family alert rules
- All placeholder data — real data comes when WhatsApp + Gmail connected
- Fishing tides at The Spit, Middle Harbour
- Password vault (face-gated)
- Phone help section (#96 building)

### Known Issues
- /my and /shan blank page: auth gate disabled but Safari may cache old version. Use ?v=N parameter.
- Root cause: Railway session wipes on deploy. Need persistent session store.
- Auth gate disabled on /my, /shan, /dad as workaround.

## NEXT SESSION
1. Check if /my and /shan load (try ?v=6)
2. Check dad's page updates from tasks #95, #96
3. Re-dispatch #91 (Sam's paper analysis + ratings on derm page)
4. Test MediaPipe finger detection on auth page
5. Fix root cause: persistent sessions instead of in-memory

---
## S110 addendum (8 Jun, chat-Claude) — gesture-auth architecture findings (Caroline demo context)
- **MediaPipe vs Gemini roles clarified:** MediaPipe HandLandmarker = local, in-browser, free, real-time per-frame finger tracking (21 landmarks) for instant UX feedback (the tick). Gemini = cloud, authoritative liveness/deepfake/duress verification of the recording, once. Complementary: Gemini physically can't do per-frame interactive feedback (latency+cost); MediaPipe can't judge liveness. Two failure points BOTH on the MediaPipe side (CDN load + orientation math), neither touches Gemini.
- **F-NEW (pre-flight): add a MediaPipe readiness check to the auth pre-flight**, mirroring the existing mic/camera AV test (auth.html ~391-1365 "Speak now to test your microphone"). Sequence: camera ✓ → mic ✓ → MediaPipe model loaded ✓ → live "show your hand" detection-firing confirmation → THEN begin challenge. Directly de-risks the #1 gesture-auth flakiness (CDN load failing silently → timer fallback). Catch it in friendly pre-flight, not mid-auth.
- **MATERIAL FINDING — multi-modal verdict is partly simulated (D-NEW candidate, shipped-vs-running class):** `/v1/single-gesture/verify` (vac-backend main.py ~1096) computes a server-side weighted composite (video_liveness 0.35, voice_biometric 0.25, otp 0.20, geolocation 0.20). BUT: voice_biometric is `voiceprint_match: True # simulated`, score hardcoded to 0.85 if OTP matched (NOT a real voiceprint check); geolocation score is soft. REAL work today = Gemini video liveness/deepfake/duress + OTP. Voiceprint + geo are stubbed. vat_engine has an explicit "Simulated (Demo Mode)" posture. → For Caroline phase-2: honest claim is "face liveness really AI-verified (Gemini); other modalities scaffolded" — do NOT imply all 6 modalities independently real (consistent with never-claim-Posture-C). → Capture as debt: modalities appear in composite without doing real work (same F-152 shipped-vs-running blind-spot class).
- Test bench live at vacprotocol.org/finger-test (orientation-invariant math, awaiting Rob's live multi-angle test). Demo live at vacprotocol.org/tribunal.

## S110 addendum 2 (8 Jun) — voiceprint reality check (Rob asked: is it working? reuse from FolioAI?)
**ANSWER: voiceprint speaker-IDENTITY is NOT implemented anywhere — not VAC, not FolioAI. Separate, non-trivial work.**
- **VAC `verify_voice` (engine.py:412)** = Gemini transcript check "were the expected WORDS spoken (by a live person)" = CONTENT match + liveness, NOT speaker identity. Composite `voiceprint_match:True # simulated` (main.py:1123). **No enrolled voiceprint reference is stored anywhere** (grep empty) — can't verify "same voice" without an enrolled baseline.
- **FolioAI**: Deepgram = transcription; ElevenLabs-class = TTS/generation; "vocal comparison against enrolled references" appears ONLY in vac_pay.py/patent SPEC text, not shipped code. **Nothing to lift — it doesn't exist there either.**
- **Real voiceprint = a build:** (1) enrollment capturing+storing a voice embedding per person, (2) verification extracting an embedding from the live clip + similarity vs stored, (3) a speaker-ID model (Deepgram is transcription-only; need dedicated speaker-verification e.g. pyannote/SpeechBrain embedding or a speaker-ID API). Touches auth-critical path → proper testing. NOT a config tweak, NOT doable "now" from chat.
- **HONESTY CONSTRAINT for Caroline + any pitch:** the REAL, strong claim today = AI-driven face liveness + deepfake + duress (Gemini). Voiceprint identity + true multi-factor = ROADMAP. Do NOT imply voice-identity is live. Consistent w/ never-claim-Posture-C + the existing "Simulated (Demo Mode)" vat_engine posture.
- **Debt:** voiceprint(+geo) appear weighted in the composite verdict (voice 0.25, geo 0.20) without doing real work = shipped-vs-running gap (same F-152 class). Real verdict today leans on Gemini-liveness(0.35)+OTP(0.20). Audit the VAC verification stack before Sam/regulated reliance.

## S110 addendum 3 (8 Jun) — finger-test bench VALIDATED LIVE + skeleton overlay = port into auth.html (gesture fix)
**Rob tested /finger-test live (screenshot confirmed):** orientation-invariant finger math WORKS — thumb+2 fingers correctly = 3 (thumb 25°/0.67 → up, index 1° → up). Thumb angle+spread fix (f24f2f8) good enough. The four-finger vector-angle math holds at angles (the hard problem, solved). Rob loves the SKELETON OVERLAY (dots+connector lines on the hand) — "shows real tech."
**KEY: the bench uses the SAME MediaPipe HandLandmarker auth.html already loads — not a different system.** So bringing it into auth is a PORT, not a rebuild. Three things to bring from /finger-test → auth.html:
  1. Skeleton overlay (dots + connectors) — UX/credibility win, shows the user they're being tracked live during biometric auth.
  2. Fixed orientation-invariant finger math (vector-angle MCP→PIP vs PIP→TIP) — REPLACES the broken tip.y<pip.y at auth.html L801-807.
  3. Improved thumb logic (joint-angle + spread) — validated live tonight.
**This IS the D-VAC-GESTURE-MEDIAPIPE fix (S101 packet `93e43ed`), now DE-RISKED — the math is proven live.** Remaining per the packet: bundle the MediaPipe SELF-HOST fix (L-721, so auth path isn't CDN-fragile) + the F-NEW MediaPipe pre-flight check (mirror the AV mic/cam test) into the SAME port.
**DO NOT port tonight (engineering discipline):** auth.html is the LIVE auth critical path (feeds Gemini verify + recording + composite). Needs proper L0: branch, orientation-fixture probe, multi-LLM gate, live test ≥2 devices/≥4 orientations, self-host bundled. NOT a late-night edit. = clean first task of a focused VAC session / Conductor lane. Then flows into Caroline phase-2 (real biometric step in the tribunal demo).
**Bench reference impl lives at vac-web/finger-test.html** (countFingers + thumbState + drawLandmarks) — copy these into auth.html.

## S110 addendum 4 (8 Jun) — auth end-to-end test result on /auth-test
**WIN:** finger detection drove the flow end-to-end for the first time — progressed through each digit based on REAL hand detection (not timer). Console confirmed HandLandmarker active + "Graph successfully started running". Skeleton overlay (dots+lines) shows on hand; perf fixed (cached ctx, willReadFrequently) + enlarged + phone-responsive sizing. Challenge text box now recedes to 25% opacity when hand visible (clean skeleton view).
**BLOCKER (backend, not auth front-end): GEMINI_API_KEY not set on prod VAC backend** → verification runs SIMULATED (engine.py:320 `self.simulated = not GEMINI_API_KEY`; 656 `if not HAS_GENAI or not GEMINI_API_KEY`). Result: face liveness / deepfake / lip sync / finger-gesture all return "service unavailable (will retry)" → 2/7 passed, trust 0.2. Deepgram WORKS (transcribed "Robert Sagarella 25" vs expected) so Deepgram key IS set; only Gemini missing (or genai lib not installed). SAME CLASS as SerpAPI-400 + dispatch-db + voiceprint: a prod dependency unwired, failing silently behind a friendly message. FIX = set GEMINI_API_KEY in Railway VAC backend env (+ confirm genai installed) — needs Rob/Mini w/ Railway dashboard + the key. Front-end auth (detection+overlay+flow) is DONE on /auth-test; verification engine can't verify until the key is set.
**Also:** challenge expects exact phrase incl all digits spoken individually ("2 5 1" not "251"/"25") — UX note for the demo.
**Next:** (1) set GEMINI_API_KEY on prod → retest /auth-test full pass; (2) promote /auth-test → /auth; (3) self-host MediaPipe + pre-flight (S101 packet); (4) phone test; (5) wire real auth into Caroline tribunal demo step 1.

## S110 addendum 5 (8 Jun) — /auth-test FULL RUN via Claude-desktop observer: GEMINI WORKS + real remaining bug identified
**MAJOR WIN: Gemini key fix worked.** Full run = trust 0.7, 6/7 passed: Face Liveness 0.90✓ Deepfake 0.90✓ Voiceprint 0.98✓ Lip-Sync 0.95✓ Challenge 0.60✓ Duress 0.95✓ — the 5 Gemini-backed modalities now return REAL scores (the "service unavailable" GEMINI_API_KEY blocker is RESOLVED). (Voiceprint 0.98 still the SIMULATED path per F-556 — real voiceprint still F-556 work.) Detection-driven advancement CONFIRMED via console: phase2_entering→grace_complete→path_detection→detect_first_finger_advance→detect_all_digits_complete→step4, NO timer-expiry, NO fallback/too-slow lines (retry-latch fix + slow-limit raise appear to hold).
**THE REAL REMAINING BUG (next-session fix): detection↔recording desync.** Finger Gesture FAILED 0.43: "expected [2,3,5] but Gemini saw [2]". Root cause: local MediaPipe detection advances FAST (paced by Rob's hand, ~3s for 3 digits) and fires detect_all_digits_complete → jumps to step 4, but the RECORDING (video sent to Gemini) runs on a FIXED clock (auth.html ~1508-1511: PHRASE_DURATION + digits×DIGIT_DURATION) and gets stopped early — so the recorded video only captured digit [2] before detection ended it. The two subsystems are out of sync: detection paces itself; recording is fixed-duration; detection-ends-early truncates recording before Gemini has footage of all digits. FIX = recording must stay open long enough to FILM each digit detection advances through (e.g. stop recording when detect_all_digits_complete AND a per-digit minimum dwell has elapsed, OR drive recording duration from detection progress not a fixed clock). Touches 3 interlocking pieces (detection pacing, recording duration, stop trigger) — real fix, needs care + multi-angle/phone test, NOT a late-night patch.
**TIMER SIMPLIFICATION (next-session): remove the decorative "RECORDING" countdown ring during the FINGER phase** — observer confirmed it runs but does NOT drive advancement (detection does), so it's misleading. KEEP the "RECORDING IN 2-1" pre-roll (get-ready beat) + the phrase/voice window (genuinely time-based). Only the finger-phase countdown is redundant.
**State:** /auth-test has fixed orientation-invariant math + skeleton overlay (perf+sized) + text-recede + retry-reset. NOT yet promoted to /auth. Next: detection-recording sync fix → timer cleanup → self-host MediaPipe + pre-flight → phone test → promote → wire into Caroline tribunal demo phase-2.

## S110 addendum 6 (8 Jun) — GEMINI FLAPPING + auth-test state for next session
**Gemini modalities went DOWN again** (worked 6/7 trust 0.7 at ~21:09; now Face Liveness/Deepfake/Lip-Sync/Finger all "service unavailable — will retry", trust 0.34→0.19 across 2 runs). Backend health 200, front-end fine. Most likely cause given MANY test runs tonight: **Gemini API QUOTA / rate-limit** (each full run = 4+ Gemini calls; key may be free-tier or shared with Athena routing) OR key unset on a redeploy. NOT a code bug — backend dependency flapping silently behind "will retry". 3rd instance tonight of the F-152 silent-dependency pattern (SerpAPI, dispatch-db, now Gemini). **NEXT (Rob/backend): check VAC backend logs for the actual Gemini error — if quota, need higher-tier or dedicated VAC Gemini key (not shared w/ Athena). This is the blocker — downstream auth fixes untestable until Gemini is STABLE.**
**Detection/timing fixes landed but PARTIALLY effective + a bigger timer found:**
- Sync fix (MIN_DIGIT_DWELL_MS=700 + 1500ms tail) pushed (9b31d51) — but observer still saw held_frames:12 advance; dwell may not be gating fully. Re-verify once Gemini stable.
- **NEW: a MASTER ~10s phase countdown** ends the finger phase regardless of detection (observer: phase auto-advanced to step4 when 10s hit zero in run 1). This is the bigger timer to address — individual digits advance on detection+hold%, but the phase is bounded by this hard 10s clock. Find + reconcile (let detection completion end the phase, with the 10s only as a max-timeout safety, not the primary driver).
- Counts mismatch [2,1,2] vs expected [1,2,4]: note this was the CHROME-CLAUDE agent holding fingers — partially the anti-spoof working (an agent isn't Rob doing the real gesture). A clean pass needs Rob live. But the "capped at 2 / never saw 4" pattern also suggests the overlay/count still under-reads higher counts at some angles — re-test live.
**auth-test state:** orientation-invariant math + skeleton overlay (perf/size/recede) + retry-reset + sync-dwell, all on /auth-test (NOT promoted to /auth). Front-end close; blocked on Gemini stability. Next-session order: (1) fix Gemini availability/quota [backend], (2) re-verify detection+sync live with Rob, (3) reconcile master 10s timer, (4) self-host MediaPipe + pre-flight, (5) phone test, (6) promote /auth-test→/auth, (7) wire into Caroline tribunal demo phase-2.

## S110 addendum 7 (8 Jun) — Gemini diagnosis CORRECTED + excellent UX critique (Chrome-Claude, 3 runs)
**CORRECTION: it's quota/rate-limit, NOT video size.** Bitrate cap (f8f0ec4) did NOT fix it. 3 runs: Gemini block (Face Liveness/Deepfake/Lip-Sync/Finger) flips ALL-OR-NOTHING — all err (runs 1,3) vs all 0.90-1.00 healthy (run 2), uncorrelated with recording length. That block-flip = upstream THROTTLE (single dependency intermittently rejecting), classic 429/quota, NOT size. We hammered Gemini with many test runs tonight; key likely free-tier or shared w/ Athena routing. F-558's bitrate cap was right fix for wrong cause; File API still good hygiene but the REAL fix = **dedicated VAC Gemini key + higher quota tier** + error differentiation (client never sees WHY — no 429 surfaced, just "service unavailable" = the F-152 blindness in one line). Oddity: non-Gemini signals INVERTED on the good run (Voiceprint+Challenge 0.00 in run 2, fine in 1,3) — no single run got everything green; best was 0.48. Worth a look but secondary to the Gemini throttle.
**ACTION (Rob/backend, the real blocker):** (1) VAC backend Railway logs → find the actual Gemini error (expect 429 RESOURCE_EXHAUSTED). (2) provision a DEDICATED VAC Gemini key (not shared w/ Athena) and/or higher tier. (3) F-558 error-differentiation so failures say WHY. Until Gemini quota is sorted, NO run will get a clean 7/7 — and chasing it frontend-side is pushing on a rope.
**UX CRITIQUE (act on — frontend, independent of Gemini, HIGH VALUE for Caroline):**
1. **Don't show red "WHY IT FAILED" when fault is OURS.** 4× red "service unavailable" reads as "user rejected" on a security product. Replace w/ honest reassuring copy ("Some checks couldn't run — that's on us. Retrying…") + silent auto-retry, not a red failure panel. BIGGEST impression fix.
2. **Finger-hold never resolves to a confirmed lock** — stalls at "hold steady 92%" then timer races past before last digit locks. = the master-10s-timer racing detection. Bar must hit a clear per-digit "✓ got it" lock, OR timer waits for gesture.
3. **3 competing countdowns = test-anxiety** (RECORDING-IN preroll + live RECORDING countdown + per-digit hold%). Drive by DETECTION not clock; generous/pausable timer.
Step notes: Step2 "Proceed" sits disabled w/ no explanation until mic registers (add hint); "Streamlined: 1 of 6 modalities" = confusing jargon; privacy note ("no video retained") well-placed + reassuring. Step4 expandable modality table = nice transparency BUT red err rows + sub-0.5 score makes polished product look broken. Visual design praised (clean dark UI, hand-overlay, trust-score concept); RELIABILITY (flaky Gemini + racing timer + no gesture-confirm) is what undercuts trust.

## S110 addendum 8 (8 Jun) — detector warm-up REVERTED (regression) + the real fix for next time
**What happened:** attempted to fix the first-finger cold-start lag (Rob: dots appear late on digit 1, in sync by digit 2 — real symptom, MediaPipe's ~0.8-1.5s first-inference GPU/WASM warmup landing on the first digit) by running silent FingerDetector.detect() during the speak phase (commit 0637684). It REGRESSED — "MediaPipe didn't trigger at all", generic "Verification error". Root cause of the regression: MediaPipe detectForVideo is TIMESTAMP-SENSITIVE (requires monotonic increasing timestamps, single caller) — the warm-up loop competed with / corrupted the detector state so the real loop couldn't run (likely tripped FingerDetector.failed or threw on timestamp). REVERTED (9896de7) — /auth-test back to known-good (the 7/7 two-clean-runs state, b719026).
**The underlying fix is still VALID, just needs correct impl (next session, careful):** warming MediaPipe before the first digit is the right idea. Correct approach: (a) feed monotonic `performance.now()` timestamps consistently to ONE detect path; (b) don't run two detect loops — instead start the SINGLE real detection loop earlier (during speak), but suppress advancement/skeleton until the finger phase, so the same loop warms the model AND drives detection (no second caller, no timestamp conflict); OR (c) call a lightweight warm-up ONCE (a couple of frames) guarded so it can't trip _hasFailed, then hand a clean detector to the loop. Test live BEFORE moving on — this is detection critical path, not cosmetic.
**LEARNING (capture L-NNN): a "polish" change on the detection/auth critical path is NOT a safe change — verify live before proceeding.** Treated a critical-path edit like a cosmetic one, shipped without a live-confirm, regressed a working flow. Critical-path UI/detection changes need the same verify-before-trust discipline as backend — confirm on a live run before the next edit.

## S110 addendum 9 (8 Jun) — warm-up attempt #2 ALSO regressed → STOP trying from chat
Second attempt at the first-finger cold-start fix (voice-triggered one-shot warmOnce, commit 8ea1bf3) ALSO broke detection ("not detecting fingers, MediaPipe not triggering"). REVERTED (e10af96) — back to known-good 7/7 state. TWO consecutive regressions on the same fix from chat-Claude editing blind.
**HARD GUIDANCE: do NOT attempt the detector warm-up / cold-start fix from chat-Claude again.** The MediaPipe detector state (timestamp sequencing, _hasFailed latch, init/ready lifecycle) is too fragile/interconnected to edit safely blind — chat-Claude can't run it or see the console when it breaks, and each attempt burns the working state via a live deploy + manual test. This fix MUST be done on the Mini with Claude Code where it can run, watch console, and iterate in a tight loop. Likely the warmOnce/voice approach is even fine — but it needs live console debugging to see WHY detection stops (probably the warm call leaves the detector in a state the real loop's first detectForVideo rejects on timestamp, OR an exception path we can't see from chat).
**The cold-start lag is MINOR** (first finger slightly delayed, synced by 2nd) on a flow that otherwise works 7/7 end-to-end. NOT worth risking the working system. Defer to a focused Mini session.
**KNOWN-GOOD baseline = e10af96** (everything from tonight EXCEPT warm-up: orientation-invariant math, skeleton overlay, digit strip above video, calm progress timer, graceful failures, detection-recording sync, retry-reset; + F-558 backend live). This is the state to promote to /auth and demo to Caroline.

## S110 addendum 10 (8 Jun) — F-559 hand pre-flight BUILT + sequential gate; cold-start theory DISPROVEN
**SHIPPED (working, /auth-test):** F-559 hand pre-flight in the camera/mic step — Hand pill + live skeleton overlay (Rob confirmed "works great, asks to move back etc"). PLUS guided SEQUENTIAL gate (9c4f59e): avGuide banner walks Step 1 lighting → Step 2 mic → Step 3 hand → All set; Start gated on all three (was light+mic only). Additive, doesn't touch in-challenge loop, Hand-framing guidance now impossible to miss.
**IMPORTANT — cold-start theory is WRONG:** the first-finger lag PERSISTED even after the hand pre-flight warmed MediaPipe (Rob: "same problem occurred...mediapipe detected on the second number"). If cold-start were the cause, pre-flight warming would have fixed it. It didn't. So the 2 reverted warm-up attempts (addendum 8/9) were fixing the wrong thing. DO NOT build more warm-up fixes.
**Real cause UNKNOWN — needs console data before fixing (do NOT theorize/patch blind again — 2 regressions already):** clue = earlier observer saw detect_first_finger_advance `frames_before_first_detect: 487` (several seconds before first detection registered, model already warm). Candidates to investigate WITH console: (a) the 1.5s GRACE period interaction when hand is already up during speak phase; (b) the MIN_DIGIT_DWELL_MS / STABLE_FRAMES first-accept gate (lastAcceptedCount starts 0, detected!==lastAcceptedCount); (c) first-frame detection genuinely not registering for ~487 frames. NEXT: capture console ([VAC]/phase2/detect_first_finger_advance + timing) during the first digit on a live run, THEN diagnose. The fix must be evidence-led, not theory-led.

## S110 addendum 11 (8 Jun) — cache confusion + OTP timing notes + OUTSTANDING racing bug
**"Older version / no hand test" = BROWSER CACHE, not a revert.** Verified live /auth-test (df0515c) HAS all features: avPillHand, Step 1 of 3 sequential gate, GRACE_MS=600, LATCHED. Nothing reverted. Fix for Rob: DevTools → right-click reload → "Empty Cache and Hard Reload" (plain Cmd+Shift+R insufficient after many deploys). Worth adding a cache-busting version query or meta no-cache to /auth-test for testing sessions.
**First-finger lag FIXED + confirmed by Rob** ("yes that did it") — was the 1.5s grace DETECTION BLACKOUT (not cold-start; console proved detection works on first active frame). Fix: grace 1500→600ms + skeleton-draws-during-grace (fd911ab). Latch fix for hand pre-flight re-nag (df0515c) also confirmed fine.
**OTP inconsistencies (not bugs, but UX notes):** (1) "sometimes asks for code, sometimes not" = `[VAC] Email already OTP-confirmed, skipping to camera` — session remembers OTP confirmation, intended but feels inconsistent. (2) "wrong code" incident = Rob entered a STALE code from a previous attempt because email delivery was slow that time (usually fast). Email-delivery latency is variable → user may enter an old code. Consider: invalidate old codes clearly, show "new code sent" state, or note expected delivery time.
**OUTSTANDING BUG (not yet fixed — needs console data): "races through the last 1-2 digits," WORSE on retry.** Symptom: first digit fine now, but last digits accepted too fast before Rob can show them; retry worse. Suspect: per-digit MIN_DIGIT_DWELL_MS not enforced after the first digit (digitStartTime/dwell interaction once hand stays up and just changes count), and/or window.__vacDetectedCounts persisting across retries (it's on window, not reset in retryVerification). NEEDS: console capture of timestamps between each digit advance (first run vs retry) to confirm dwell is being skipped, BEFORE fixing (evidence-led, per tonight's lesson). Prompt for desktop-Claude observer prepared.

## S110 addendum 12 (9 Jun) — grace 300ms; "5"/open-hand detection fragility + advance-gate accepts wrong count
**Grace dropped 600→300ms (4861f1e)** per Rob. If first-finger delay "looks the same," likely still cached — confirm via /auth-test?v=N and check console grace_ms (300=new). 300ms is near the perceptible floor; residual is inherent camera-frame latency.
**FINDING A — "5" / open-hand pose is detection-fragile (esp. up close):** Rob showed 5 (all fingers), it would NOT lock/advance; he moved hand closer/back repeatedly, no luck; switched to 4, advanced cleanly. MediaPipe counts an open splayed hand less reliably up close (fingers clip frame edges / merge). Candidate fixes (NEXT session, real-hand iteration — do NOT tune blind): widen the count-tolerance for 5, or relax stability for 5 specifically, or improve the "spread fingers / move back" coaching when a near-5 partial is detected. Related to the framing guard already shipped.
**FINDING B — local advance gate accepts a HELD DISTINCT count, not the CORRECT count:** Rob completed the gesture showing 4 when challenge wanted 5; local detector advanced (it only checks "a distinct number was held ~dwell"), gesture "completed", then SERVER verification correctly FAILED (wrong count). Re-verification with correct numbers passed. By design (Gemini validates actual count server-side, L-255-style — local detection is liveness/cadence not ground truth), BUT the UX is confusing: user appears to succeed at the gesture then fails verification with no clear "you showed the wrong number" signal. Consider: surface a gentle client-side "that didn't match — show N" hint when the held count != target (without being authoritative), OR make the failure message name the gesture mismatch. UX decision for next session.

## S110 addendum 13 (9 Jun) — BUG CLUSTER on retry/last-digit/verified-state — DO NOT promote /auth-test→/auth until fixed
Rob hit a tangled cluster (needs careful evidence-led fix next session, NOT blind — late hour, interacting bugs, and my confirmation-beat change e0c1f02 may interact):
1. **LAST DIGIT finishes before audio.** On the final digit, the gesture being accepted ends the finger phase / advances to verification BEFORE Rob can SAY the number. So the last digit's spoken/audio component is never captured. SUSPECT: finishFingerPhase fires immediately on last-gesture-accept with no room for the voice; may be worsened by the new CONFIRM_BEAT_MS timing. Likely needs: on the LAST digit, don't end on gesture-accept — leave a window (or require the voice) before finishing.
2. **RETRY LOOP won't pass with correct numbers.** Rob showed correct digits, kept failing + re-running. Likely DOWNSTREAM of #1: if the last digit's audio never captured, server verification legitimately fails every retry → infinite-feeling loop. Confirm by checking whether the failures correlate with the audio-missing last digit.
3. **INTEGRITY BUG (highest priority): "Continue Anyway" → showSuccess() marks VERIFIED after a real FAILURE.** btnContinueAnyway (line ~563) appears after MAX_RETRIES=5 (line ~2339) and calls showSuccess() directly — so a FAILED verification reaches the success/verified state + writes vac_verified to localStorage + posts vac-auth-success. Rob: "got to 5 of 5, gave me Continue Anyway, says I am verified when I really failed." On /auth-test this is contained (test surface, no real users), but it MUST NOT reach /auth. Fix needs a decision: after max retries, show an honest FAILED terminal state — NOT a path to success. (Possibly "Continue Anyway" was a dev convenience; if so, remove it or gate it behind a non-prod flag.)
**GATE: do NOT promote /auth-test→/auth until #3 (integrity) is resolved + #1/#2 fixed and a clean real-hand run passes honestly.**
**Diagnostic approach (per L-774): get console + network data first** — for #1, timestamps of last detect_digit_advance vs finishFingerPhase vs recorder.stop; for #3, confirm whether showSuccess is reached with a failed authResult (client lying) vs server returning pass. Evidence before fix.

## S111 addendum 14 (10 Jun) — F-561 AND-gate BUILT (uncommitted) + 4-finding diagnosis cluster + VAD calibration + Gemini-fail root. STOPPED before fixes (integrity-critical, not rushing tired).

**BRANCH:** `Schemo512/f561-multimodal-advance-gate`. All work in `auth-test.html` (test surface; `/auth` untouched).

### WHAT'S COMMITTED vs UNCOMMITTED (do not lose this state)
- **COMMITTED (F-560 QA overlay):** `f268371` (`?qa=1` advance-gate debug overlay) + `1e4bd95` (wrap so the live line incl sOk stays on-screen). Verified live by Rob.
- **UNCOMMITTED in working tree (~178 insertions, `auth-test.html`):**
  - **F-561 advance-gate change** — the real behavior change. Gate at ~line 2205: `if (_gestureOk && _speechOk && _nowMs >= _confirmUntil)`. `_gestureOk` unchanged; advance now ALSO requires `_speechOk` per digit.
  - **#2 diagnostic instrumentation** (QA overlay layer) — `speech_confirm` now carries triggering `rms`; new `speech_window_open` event; overlay row shows `win:` + `s:…(rms …)`; legend reworded.
- **NEXT SESSION: split these** — `/codex` the F-561 gate diff → commit F-561 gate on its own → instrumentation can ride with the F-560 overlay lane or stand alone. They're the same file, use `git add -p`.
- **HANDOFF.md addendum 14 itself is uncommitted** (per Rob's hold) — separate file from the F-561 diff, safe to `git add HANDOFF.md` standalone if you want it in history.

### DECISIONS LOCKED (S111, via /plan-eng-review)
- **D1 — Speech gate is VAD-ONLY, on-device.** webkitSpeechRecognition is NOT used (in Chrome it streams mic audio to Google = contradicts the doc's "zero network round-trip" + the page's privacy copy). **This SUPERSEDES the F-561 substrate doc's "prefer webkitSpeechRecognition" line — the substrate was wrong on that point.** Words never leave device; content stays server-side Gemini. Reuses existing `audioAnalyser` (startAudioMonitor) — no 2nd AudioContext, no new getUserMedia, no permission prompt.
- **D2 — Stuck-user escape is explicit, never silent.** Gesture held ready ~12s with no speech → "Mic not working? Tap to continue with gestures only" → `_speechMode='off'` for this digit AND the rest, logged `vacDebug('voice_gate_escape')`. Overrides the wrong 8s "hold hand closer" hint. Fallback chain: VAD → (VAD unavailable) gesture-only + visible "(voice gate off)" note → never silent auto-advance (W4.1).

### (1) VAD CALIBRATION — set next session (Rob's live numbers)
- **Noise floor (silent) rms = 0.074. Speaking rms = 0.175–0.242.** Gap is TIGHT (~0.10 wide, ~0.035 margin each side).
- **NEXT: set `VAD_SPEECH_RMS ≈ 0.14`** (currently 0.12, ~line 1895) **AND raise `VAD_SPEECH_FRAMES`** (currently 3 ≈ 50ms, ~line 1896) — e.g. 3→6 (~100ms) — so a brief transient (breath/tap/movement) can't cross the threshold in the tight gap. `VOICE_HELP_TIMEOUT_MS=12000` (~line 1897) also tunable.

### THE 4 FINDINGS — DIAGNOSED ONLY, NOT FIXED (root causes located in code)
- **#1 — Re-auth stale DOM.** `refreshVerification()` (3155) = `authResult=null` + `goToStep(1)`. `goToStep` (1115) only flips `.active`/dots — never resets the `navStatus` "AUTHENTICATED" badge (set `showSuccess:3000`) nor clears the skeleton canvases (`#handOverlay`/`#avHandOverlay`; `clearRect` only runs inside the draw loops at 1503/2127). Gate/recorder state DOES reset (fresh `beginRecording` closure). So stale state is **purely DOM: badge + canvas.** Integrity-adjacent to addendum-13 #3.
- **#2 — Silent gesture advanced (`s:+16210`).** Window-reset logic is CORRECT (`speechWindowStart = now + CONFIRM_BEAT_MS` on every advance, ~2224; `_markSpeech` guards `now < speechWindowStart`, ~1961) → bleed unlikely. High-confidence cause = **energy-VAD false-fire on a non-speech transient** (zero voice discrimination; thr 0.12 untuned). Rob's tight live gap (0.074↔0.175) CONFIRMS transients can fire it. Instrumentation now in place to prove per-fire next pass (rms value + window-open time).
- **#3 — Instruction text occluded by skeleton.** Pure z-index: `.camera-overlay`/`.camera-challenge` (129/143) have NO z-index (=0); `#handOverlay` canvas (458) is `z-index:4` → skeleton paints over `#challengeText`. Worsened by `.camera-container.hand-visible .camera-challenge { opacity:0.25 }` (144). Above-video `#digitStrip` is fine (outside box).
- **#4 — Re-auth "hang" / first-finger cold-start (`stable=299/dwell=4968` = slow-start, NOT wedged).** SHARES #1's root: `refreshVerification`→`goToStep(1)` **never calls `requestCamera()`**, which is the SOLE caller of `startAVChecks()` = the F-559 pre-flight whose hand pre-flight (~1468) warms MediaPipe before recording. So detector cold-starts on the first real digit. Also: `btnCamera.onclick` rewired to `goToChallenge` in run 1 (1304), never restored, so the camera button bypasses requestCamera on re-entry; stream stopped after success (2481), not re-acquired (only `retryVerification:2948` re-acquires); global `avChecks` (1379) never reset on this path.
- **#1+#4 FIX (next session):** make `refreshVerification` a PROPER re-entry — model it on `retryVerification` (2935): re-acquire `getUserMedia`, reset `avChecks`, restore `btnCamera.onclick=requestCamera` (or just call `requestCamera()` to re-run the F-559 warm-up), AND clear the badge + both skeleton canvases. One re-entry fix likely kills both the stale-DOM and the cold-start "hang."

### (2) THE LIVE FAIL WAS SERVER-SIDE GEMINI — NOT the gate, NOT liveness
- face_liveness + deepfake + lip_sync + finger_gesture **all failing together = F-558 video-analysis error signature** (Gemini couldn't analyze the video), not a real biometric reject.
- **F-558 File API fix is BACKEND** (`vac-system` / Railway `API_BASE=vac-system-production.up.railway.app`) — NOT in vac-web. Grep of `auth-test.html` for File API/upload refs = zero (expected). **NEXT: verify the F-558 File API fix is deployed on the BACKEND the branch points at — check the vac-system repo, not here.**

### (3) RETRY LOOP won't recover after a Gemini fail + accumulates state (D3 row reappearing) = addendum-13 #2, DOWNSTREAM of the Gemini fail (2). Fix after the Gemini/F-558 root.

### SEQUENCING (next session, in order)
1. **`/codex` the F-561 gate diff** → commit F-561 gate on its own (split from #2 instrumentation).
2. **Set `VAD_SPEECH_RMS≈0.14` + raise `VAD_SPEECH_FRAMES`** (commit with/after gate).
3. **Verify F-558 File API fix on the backend** (vac-system) → fix the **Gemini/retry cluster** (addendum-13 #2, downstream of the video-analysis error).
4. **Fix #1+#4** (refreshVerification proper re-entry) and **#3** (z-index) as separate commits.
5. **Resolve addendum-13 #3 integrity** ("Continue Anyway" → `showSuccess()` marks VERIFIED after a real FAILURE) — STILL the hard gate.
6. **THEN promote `/auth-test` → `/auth`.**

### GATE (unchanged from addendum 13): do NOT promote to `/auth` until addendum-13 #3 (integrity: failure must not reach the verified state) is resolved AND a clean honest real-hand run passes. The F-561 AND-gate and the 4 findings above do not change that gate; they sit on top of it.

## S111 addendum 15 (10 Jun) — SUPERSEDES addendum 14's commit-status. F-560/F-561 all committed; live pass killed the F-558 theory; new re-auth blank-phrase bug found + fixed.

### COMMIT STATE (addendum 14 said "uncommitted" — that's STALE; it's all landed)
```
<pending>  S111: block recording on blank challenge phrase + diagnostics (this step)
a2950b6    chore: gitignore .gstack/
f4474f1    F-561/S111: refreshVerification proper re-entry (#1 stale UI + #4 warm-up)
0edaf72    F-561: tune VAD threshold (0.12->0.14, frames 3->6)
3b0f57c    F-561 #2 diag: per-digit window-open + triggering rms
15161a8    F-561: per-digit gesture-AND-speech advance gate (VAD-only)
1e4bd95 / f268371  F-560: ?qa=1 overlay (+ wrap)
```
Each was /codex-passed (P2s found + fixed before commit). NOTHING PUSHED. The one live pass below ran on code through f4474f1 (PRE blank-phrase fix).

### LIVE PASS RESULT (S111, Rob) — F-558 THEORY IS DEAD
On a good-framing recording, **6/7 modalities PASSED**: Face 0.95, Deepfake 0.98, Voiceprint 1.00, Lip-Sync 0.97, Finger Gesture 1.00 (Gemini read [3,5,2] correctly). So the earlier all-4-fail was a BAD/DIM CAPTURE, not F-558. Gemini works fine on a good recording. **F-558 backend check PAUSED — not the problem.**
- The ONLY fail: **Challenge Response 0.40** — "Heard: 3. 5." vs "Expected: Hello, I am Rob Zagarella, 3 5 2".
- Also confirmed (not a bug): the VAD gate advanced digits without full correct speech — KNOWN gate limit (VAD = sound presence, not content; Gemini owns content).

### NEW BUG (#5) — re-auth blank-phrase + THIS STEP'S FIX
Root cause (Rob observed live + static trace): on the re-auth recording, the phrase VALUE is blank — the screen shows the static label "SAY THE PHRASE" but no phrase interpolated, so Rob spoke only digits. The template (`updatePhasePrompt:1821`) interpolates correctly (`+ phrase +`), so this is EMPTY `challengeData.phrase` at render, not a template bug.
- **Fix (committing now):** `goToChallenge` AND `retryVerification` now BLOCK recording when `challengeData.phrase` is blank (never record against a blank challenge → guaranteed Challenge-Response fail), with a retry that re-fetches. Plus diagnostics `challenge_fetched` / `challenge_fetch_failed` / `challenge_blank_blocked` to pin WHY it's empty (failed fetch vs response-missing-phrase) on the next live pass.
- **Likely also resolves addendum-13 #2** (retry-loop-won't-recover): that was probably the retry path silently recording against a blank/stale challenge and failing every time. The retry guard breaks that loop.

### REMAINING (next steps, in order)
1. **Confirm blank-phrase root cause** on a live re-auth pass via the new diagnostics; finish the re-fetch fix if the backend response is dropping `phrase`.
2. **UX (a):** move ALL instruction text OUT of the camera video overlay into a panel above/beside the feed — currently overlaid on face+hand (unreadable) and DUPLICATED (ticks+digit appear both above and inside the frame). **This also kills finding #3 (z-index occlusion).**
3. **UX (b) / verify #4:** first-finger detection STILL lags on re-auth despite the step-3 warm-up — add a timestamp to verify whether `requestCamera`'s F-559 warm-up actually runs on the re-auth path.
4. **addendum-13 #3 integrity** ("Continue Anyway" → showSuccess after failure) — sequenced after the above. Leave alone until then.
5. Then a clean honest live pass → promote `/auth`.

### DEBT: every committed change here is UNVERIFIED by a live hand except the one pass above (which predates the blank-phrase + VAD-tune fixes). One honest live re-auth pass is owed before `/auth`.

### GATE still stands: no `/auth` promotion until addendum-13 #3 resolved + a clean honest real-hand run.

## S111 addendum 16 (10 Jun) — FIRST LIVE PASS PASSED. 3 gate/UX fixes + diagnostics committed & pushed. 24c4352 kept (premise corrected: misdetection, not repeats).

### LIVE PASS #1 RESULT: PASSED / VERIFIED (first honest real-hand pass)
6/7 modalities passed earlier; this pass completed end-to-end. The addendum-13 #3 integrity gate still blocks `/auth` promotion, but the flow itself now works on a real hand.

### COMMIT STATE (all pushed to Schemo512/f561-multimodal-advance-gate)
```
686f05b  S111 diag: log expected challenge digits + exp:N in QA overlay
a062245  (3) move instruction text out of camera overlay + de-dupe (finding #3)
255f279  (2) gate phrase->digits transition on speech, not a timer
24c4352  (1) repeated/MISDETECTION deadlock — Option 2 fresh-gesture gate
87fe3a6  require phrase AND digits (close bypass #1) · 4f59cd3 blank/stale guard (#5)
f4474f1 re-entry (#1+#4) · 0edaf72 VAD tune · 3b0f57c #2 diag · 15161a8 gate
1e4bd95 / f268371  F-560 overlay
```

### 24c4352 — KEPT. PREMISE CORRECTED.
- The "repeated-digit challenge" premise was PHANTOM: the deployed backend NEVER produces repeats. Evidence: 30/30 live `/v1/vat/auth/challenge` samples were 3 DISTINCT digits; `_non_sequential_digits` uses `random.sample(1..5, n)` (distinct by construction) and also rejects sequential runs ("prevents hold-same-fingers confusion"). A `[2,4,4]` challenge cannot occur.
- The REAL value is MISDETECTION-DEADLOCK protection. The old count-change guard (`detected !== lastAcceptedCount`) hard-deadlocks when MediaPipe misreads a DISTINCT digit as the last-accepted count — even though challenges are distinct.
- LIVE EVIDENCE (the deciding data): on the PASSING run the QA overlay showed `D1 cnt:4≠exp:2` — a distinct digit (expected 2) misread by MediaPipe as 4. That is exactly the misdetection case 24c4352's fresh-gesture re-arm protects against, witnessed on pass one. KEEP it.
- The `exp:N` / `≠exp` diagnostic (686f05b) earned its keep on pass one — it's how we distinguished misdetection from a malformed challenge. KEEP it.

### THREE ISSUES FIXED THIS SESSION (all /codex-passed, now LIVE-verified by pass #1)
- (1) 24c4352 — deadlock removed (per above). Repeat = quick re-show; distinct misdetect = re-show recovers.
- (2) 255f279 — phrase phase holds until VAD hears speech (timer/unavailable/hard-cap fallbacks).
- (3) a062245 — instruction text moved OUT of the camera overlay (was behind the z-index:4 skeleton) into a panel below the feed; numbers de-duped to the single #digitStrip above.

### OPEN FROM LIVE PASS #2 (being worked next)
- FIRST-FINGER LAG (visibility): the delay before the skeleton appears / detection starts looks dead to a first-time user. Make it VISIBLE ("Starting camera… / detecting your hand…" state) + add a warm-up timestamp (warm-up-start vs first-detected-frame) to measure the real lag. Don't just chase warm-up timing.
- RE-AUTH DEAD-END: clicking re-authenticate lands on the Camera & Mic pre-flight with "Complete the checks above" GREYED OUT and no way forward, even though Light/Mic/Hand all show green. The enable-Start gate isn't recognizing the passed checks on the re-auth path (likely the same re-entry state-reset family: `avChecks` not reflecting the re-run checks, or enable logic reading stale state).

### STILL OPEN: engine.py stale cleanup (flagged, separate) · bypasses #2/#3 (detector-fallback / audioAnalyser-null → gesture-only) deferred · addendum-13 #3 integrity (sequenced after a clean pass — leave alone).

### GATE unchanged: no `/auth` until addendum-13 #3 resolved + a clean honest real-hand run.
