# F-792 Copy Inventory — VAC Ceremony Flows
<!-- Generated 2026-07-14 for branch task-f792-copy-registry -->
<!-- Scope: vac-reauth-ceremony.js, vac-auth.js, tribunal-demo.html -->
<!-- Format: FILE:LINE | TIER | STEP | STRING (≤80 chars) | NOTES -->

## Classification key
- Tier: quick=fast/still-capture  full=named-greeting  nameless=skipGreeting  _common=all tiers
- Step: preflight | capture | results | denied | escalation | status | error
- WRONG = known incorrect for that tier/flow
- MIGRATED = moved to vac-copy-registry.js in this PR

---

## A. FAIL_REASONS object — vac-reauth-ceremony.js:267–300 [MIGRATED]

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 270 | _common | denied | `Face not detected or liveness check failed.` | face_liveness reason |
| 271 | _common | denied | `Make sure your face is clearly visible…` | face_liveness tip |
| 274 | _common | denied | `Deepfake indicators detected in the video.` | deepfake_detection reason |
| 275 | _common | denied | `Use your device camera directly — screen sharing…` | deepfake_detection tip |
| 278 | _common | denied | `Voice not captured clearly enough for analysis.` | voiceprint reason |
| 279 | _common | denied | `Speak the challenge phrase clearly and at normal volume.` | voiceprint tip |
| 282 | _common | denied | `Lip movements did not match the spoken audio.` | lip_sync reason |
| 283 | _common | denied | `Look directly at the camera while speaking…` | lip_sync tip |
| 284 | _common | denied | `Spoken words did not match the challenge phrase.` | challenge_response reason |
| **286** | **_common→tier** | **denied** | **`Read the challenge phrase exactly…include the greeting and all digits.`** | **WRONG for nameless (no greeting) and quick (no spoken phrase). MIGRATED to tier-specific tip.** |
| 289 | _common | denied | `Duress check — monitoring for signs of coercion.` | duress reason (advisory) |
| 290 | _common | denied | `This runs silently. If you are safe, this will always pass.` | duress tip |
| 293 | _common | denied | `Finger count sequence did not match the expected digits.` | finger_gesture reason |
| 294 | _common | denied | `Show each digit with your fingers near your face…` | finger_gesture tip (fast tier: inapplicable — no multi-gesture) |
| 297 | _common | denied | `Location could not be determined.` | geolocation reason |
| 298 | _common | denied | `Allow location access when prompted by your browser.` | geolocation tip |

---

## B. Camera/AV preflight — vac-reauth-ceremony.js:300–800 (inline, not migrated v1)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 312 | _common | preflight | `Requesting access…` | btnCamera during getUserMedia |
| 339 | _common | preflight | `CAMERA ACTIVE` | cameraLabel |
| 347 | _common | preflight | `Loading challenge…` | btnCamera during fetch |
| 382 | _common | preflight | `Could not load challenge — check your connection…` | challenge fetch error |
| 386 | _common | preflight | `Complete the checks above` | btnCamera when AV incomplete |
| 403 | _common | preflight | `Retry Camera Access` | btnCamera after permission denied |
| 571 | quick | preflight | `Hold still for a quick face check…` | step2HeaderSub (no-voice path) |
| 573 | quick | preflight | `Quick camera & mic check — next, you'll show a number…` | step2HeaderSub (with-voice path) |
| 633 | _common | preflight | `Mic: working` | AV mic pill |
| 655 | _common | preflight | `Light: too dark` | AV light pill |
| 658 | _common | preflight | `Light: dim` | AV light pill |
| 661 | _common | preflight | `Light: too bright` | AV light pill |
| 664 | _common | preflight | `Light: good` | AV light pill |
| 710 | full | preflight | `Move your hand beside your cheek` | avGuide hand step |
| 711 | full | preflight | `Move your hand back — keep the whole hand in view` | avGuide hand too close |
| 712 | full | preflight | `Move your hand closer — fill the oval with your hand` | avGuide hand too far |
| 722 | full | preflight | `Hand ✓` | avPillHand passes |
| 724 | full | preflight | `Hold steady…` | avGuide hand detected |
| 726 | full | preflight | `Spread your fingers — make sure all are clearly visible` | avGuide fingers obscured |
| 732 | full | preflight | `Hold your hand beside your cheek — we'll show it tracked` | avHandHint |
| 1294 | _common | preflight | `Microphone detected` | avMicPromptText |
| 1307 | _common | preflight | `Mic not picking up audio? [browser tip]` | avMicTip |
| 1310 | _common | preflight | `Try speaking louder or clapping` | avMicTip fallback |
| 1335 | _common | preflight | `Step 1 of [N] — find good lighting…` | avGuide step 1 |
| 1337 | _common | preflight | `Step 2 of [N] — say a few words to test your microphone` | avGuide step 2 |
| 1339 | full | preflight | `Step 3 of 3 — hold your hand up beside your cheek…` | avGuide step 3 (full only) |
| 1341 | quick | preflight | `Finishing setup, one moment...` | avGuide waiting (quick only) |
| 1343 | _common | preflight | `All set ✓  You're ready to verify` | avGuide all checks pass |
| 1352 | _common | preflight | `Start verification` / `Complete the checks above` | btnCamera final state |
| 1400 | _common | preflight | `Speak now to test your microphone` | avMicPromptText active |
| 1413 | _common | preflight | `Could not access camera/mic. Check browser permissions.` | cameraError |

---

## C. CaptureFeedback / updatePhasePrompt — vac-reauth-ceremony.js:983–1021 [MIGRATED]

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| **988** | full/nameless | capture | `Say the greeting` / `Say the phrase` | **WRONG for nameless (no greeting). MIGRATED.** |
| **1000** | full/nameless | capture | `SAY THE GREETING` (label above phrase) | **WRONG for nameless. MIGRATED.** |
| 1019 | full | capture | `SHOW FINGERS` + circles + `Show next gesture…` | finger phase panel |
| 1055 | full | capture | `Almost — show your fingers and say it at the same time` | nearmiss coaching |
| 1056 | full | capture | `Now show your [N] finger(s) as you say "[N]"` | voiceonly coaching |
| 1057 | full | capture | `Say "[N]" out loud while you hold up your fingers` | gestureonly coaching |
| 1128 | _common | capture | `All captured ✓` | done state |
| 1135 | _common | capture | `✓  Got it` | confirm beat |
| 1149 | full | capture | `Lower your hand, then show [N] again` | speech-off re-arm |
| 1159 | quick | capture | `Show [N] — hold steady` | voiceless still capture |
| 1163 | quick | capture | `Hold your hand up beside your cheek` | no hand (voiceless) |
| 1166 | quick | capture | `Hand detected — hold steady.` | hand present (voiceless) |
| 1169 | quick | capture | `hold steady` | fast sub-prompt |
| 1176 | full | capture | `Show [N] AND say "[N]" — at the same time` | simultaneous mode |
| 1184 | full | capture | `Hold your hand up beside your cheek` | no hand (full) |
| 1189 | full | capture | `Hand detected — hold steady.` | hand present (full) |
| 1196 | full | capture | `We can't hear you — a bit louder` / `together, in one go` | voice help |
| 1204 | _common | capture | `Processing…` | capture ending |
| 1211 | full | capture | `Hold hand closer to camera, fingers spread` | framing hint |
| 1213 | full | capture | `[N] gestures to go` / `last gesture` / `done` | progress counter |

---

## D. goToChallenge / renderGreeting — vac-reauth-ceremony.js:1442–1900 [MIGRATED at :2828]

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 1497 | quick | capture | `Quick re-verify — show your [N] finger(s)…and say it` | fast direct path header (with voice) |
| 1498 | quick | capture | `Keep your face in the oval — when the count starts…` | fast direct path subtext (with voice) |
| 1499 | quick | capture | `Keep your face in the oval and hold still…` | fast direct path subtext (no voice) |
| 1532 | full | capture | `Say: "[phrase]"` + `Voice-only mode (reduced trust score)` | voice-only fallback |
| 1543 | nameless | capture | `Say your numbers: "[nums]"` + `no name needed…` | nameless correct prompt |
| 1549 | full | capture | `Say: "[greeting]"` + `then show each…one take` | full named flow prompt |
| 1556 | full | capture | `Cannot show fingers? Voice-only mode` | accessibility fallback link |
| 1628 | full | capture | `[N] number(s)` | digit count in intro preview |
| 1643 | nameless | capture | `Show your numbers, one at a time.` | nameless no-voice intro |
| 1646 | nameless | capture | `On the next step, we'll show you [N] number(s) one at a time…` | nameless no-voice intro body |
| 1657 | full | capture | `"[greeting text]"` | greeting preview in challengeIntro |
| 1674 | full | capture | `Switch back to finger mode` | finger-mode toggle |
| 1680 | full | capture | `Cannot show fingers? Voice-only mode` | voice-only toggle |
| 1684 | full | capture | `"[greeting]"` + `then show each number as you say it, one take` | back-to-finger mode prompt |
| 1702 | _common | capture | `Get ready…` | countdown text |
| 1704 | _common | capture | `Get ready` | step2Title during countdown |
| 1736 | _common | capture | `Recording` | timerLabel during recording |
| 1881 | nameless | capture | `Quick re-confirm` | step2Title (skipGreeting) |
| **2828** | full/nameless | capture | `Greeting heard` | **WRONG for nameless ("Greeting" but user spoke numbers). MIGRATED.** |
| 2832 | _common | capture | `✓ Heard it` + `One moment…` | confirmation state |
| 2837 | _common | capture | `Say the phrase` | step2Title while listening (yellow) |
| 2840 | full | capture | `SAY THIS OUT LOUD` / `READ THIS OUT LOUD — INCLUDING THE NUMBERS` | challengeEl label variants |
| 2944 | full | capture | `Show the numbers` | step2Title entering finger phase |
| 2952 | full | capture | `GET READY — SHOW FINGERS` + `Starting…` | grace countdown |

---

## E. Detection loop / liveEl — vac-reauth-ceremony.js:2024–2700 (inline, not migrated v1)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 2160 | full | capture | `Mic not working? Tap to continue with gestures only` | voice escape button |
| 2184 | full | capture | `(voice gate off)` | persistent note |
| 2217 | full | capture | `Camera detector unavailable — show AND SAY each number out loud…` | MediaPipe fallback |
| 2229 | full | capture | `Shown + said it ✓ — next` | manual fallback advance |
| 2252 | full | capture | `Shown + said it ✓ — finish` | manual fallback finish |
| 2579 | full | capture | `All gestures captured ✓` | liveEl all done |
| 2584 | full | capture | `✓  Got it` | liveEl confirm beat |
| 2595 | full | capture | `Lower your hand, then show [N] again` | liveEl re-arm |
| 2601 | full | capture | `We can't hear you — say "[N]", or tap below` | liveEl voice-help timeout |
| 2602 | full | capture | `Keep showing [N] — say "[N]"` | liveEl waiting on voice |
| 2606 | full | capture | `Got it ✓` | liveEl gesture done |
| 2607 | full | capture | `Hold steady [pct]%  ([step]/[total])` | liveEl gesture progress |
| 2611 | full | capture | `Show [N] finger[s] AND say "[N]" — at the same time` | liveEl no hand |

---

## F. Progress/results/errors — vac-reauth-ceremony.js:3700–4090 (inline, not migrated v1)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 3714 | quick | results | `Quick re-auth was not confirmed…` / `Quick re-auth complete…` | verifySubtitle (quick) |
| 3764 | quick | results | `Face match` + detector detail | quick face row |
| 3765 | quick | results | `Number on fingers` + detector detail | quick finger row |
| 3766 | quick | results | `Passive liveness` + detector detail | quick liveness row |
| 3846 | full | status | `Uploading recording…` | progressStep |
| 3893 | full | status | `Analysing biometrics…` | progressStep |
| 3901–3907 | full | status | pSteps array | progress steps |
| 3939 | _common | error | `Connection dropped — retrying upload…` | transport retry |
| 4033 | full | results | `Human verified ✓` | progressStep on pass |
| 4039 | full | results | `Verification incomplete` | progressStep on fail |
| 4050–4072 | _common | error | various catch-block error messages | error states |

---

## G. No-mic/capture recovery — vac-reauth-ceremony.js:4470–4518 (inline, not migrated v1)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 4478 | _common | capture | `Camera or microphone dropped — restart verification` | recovery title |
| 4479 | _common | capture | `Your camera or microphone stopped unexpectedly…` | recovery body |
| 4480 | _common | capture | `Restart verification` | recovery button |
| 4492 | _common | capture | `We can't hear you — check your mic` | no-mic title |
| 4498 | _common | capture | `Your mic is connected but very quiet…` | no-mic body (quiet) |
| 4500 | _common | capture | `Reconnect mic & retry` | recovery button 1 |
| 4501 | _common | capture | `Continue — skip voice` | recovery button 2 |
| 4503 | _common | capture | `Start over` | recovery link |

---

## H. run() context-driven overrides — vac-reauth-ceremony.js:5438–5456 [MIGRATED]

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| **5445** | nameless | preflight | `Say your numbers, showing each on your fingers beside your cheek. Wait for the ✓.` | step2HeaderSub. MIGRATED to registry. |
| **5446** | nameless | preflight | `Say your numbers out loud, then show each on your fingers…No name or greeting needed…` | combinedCaptureText. MIGRATED. |
| **5450** | quick | preflight | `Quick re-verify — show the number beside your cheek and say it out loud. Wait for the ✓.` | step2HeaderSub (still). MIGRATED. |
| **5451** | quick | preflight | `Quick re-verify — show the number beside your cheek…no greeting is needed.` | combinedCaptureText (still). MIGRATED. |
| **5455** | full | preflight | `Show the number beside your cheek and say it out loud. Wait for the ✓.` | step2HeaderSub (policy-no-voice). MIGRATED. |
| **5456** | full | preflight | `Show the number beside your cheek — a quick face + number check…no greeting is needed.` | combinedCaptureText (policy-no-voice). MIGRATED. |

---

## I. CEREMONY_HTML static defaults — vac-reauth-ceremony.js:4720–5019

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 4728 | _common | preflight | `Step 2 of 4` | header eyebrow |
| 4729 | _common | preflight | `Camera & Mic` | header title |
| **4730** | full | preflight | `Let's check your camera, mic & light — hold your hand up beside your cheek…Next step: you'll say a greeting…` | Default wrong for quick/nameless (overridden by run(), but still a wrong default) |
| 4743 | _common | preflight | `Position face in oval` | face oval label |
| 4752 | full | preflight | `Hold hand beside your cheek` | handZonePreflight |
| 4754 | _common | preflight | `AWAITING CAMERA` | cameraLabel initial |
| 4766 | _common | preflight | `Speak now to test your microphone` | avMicPromptText initial |
| 4777 | _common | preflight | `Refresh camera & mic` | retryAVSetup button |
| 4783 | _common | preflight | `Checking your camera…` | avGuide initial |
| 4795 | _common | preflight | `We store a text description…no photos or video are retained.` | privacy statement |
| 4798 | _common | preflight | `Enable Camera & Microphone` | btnCamera initial |
| 4821 | _common | capture | `Step 3 of 4` | header eyebrow |
| 4822 | _common | capture | `Complete the Challenge` | step2Title DEFAULT |
| **4917** | full | capture | `Say the greeting, then show each number as you say it…` | combinedCaptureText DEFAULT — wrong for nameless/quick (overridden by run()) |
| **4930** | full | capture | `First a greeting,\nthen your numbers.` | challengeIntroHeadline — overridden for nameless |
| 4956 | _common | status | `Start over` | back button |
| 4958 | _common | status | `Step 4 of 4` | step 3 eyebrow |
| 4959 | _common | status | `Verifying You're Human` | verifyStepTitle DEFAULT |
| 4960 | _common | status | `Sending biometric data to verification engines…` | verifySubtitle default |
| 4974 | _common | results | `Verification Modalities` | toggle label |
| 4979–4985 | full | results | Modality names + descriptions | not migrated v1 (static, no tier variation) |
| 5006 | _common | denied | `Why it failed` | retrySection label |
| 5010 | _common | denied | `Try this` | retrySection tips label |
| 5014 | _common | denied | `Retry Verification` | retry button |
| 5015 | _common | escalation | `Continue Anyway` | escalation button |

---

## J. vac-auth.js — Ceremony-flow strings (lines 686–1407)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 686 | full | preflight | `Biometric verification` | heading before full-auth |
| 687 | full | preflight | `You'll speak a challenge phrase on camera while showing finger gestures…` | biometric description |
| 693 | full | preflight | `Start verification` | start button |
| 720 | _common | error | `Camera access required for verification.` | camera permission error |
| 773 | _common | escalation | `Waiting for vouch` | vouch heading pending |
| 778 | _common | escalation | `One more step` | vouch heading requesting |
| 784 | _common | escalation | `VOUCH PENDING` + `We'll notify you when it's confirmed` | vouch pending state |
| 789–795 | _common | escalation | vouch form labels | escalation form |
| 942 | quick | capture | `Welcome back, [email]` | quick reauth heading |
| 943 | quick | capture | `Hold up [word] finger(s) near your face` | quick reauth instruction |
| 944 | quick | capture | `[N] finger(s) + face visible` | quick reauth status |
| 953 | quick | capture | `Verify it's me` | quick reauth button |
| 968 | _common | error | `Connection error — please try again` | network error |
| 970 | _common | error | `Retry` | retry button |
| 1032 | _common | denied | `Try again` | retry after failure |
| 1073 | quick | denied | `Identity not confirmed` | face-mismatch heading |
| 1074 | quick | denied | `Face did not match…Full verification required.` | face-mismatch body |
| 1081 | quick | escalation | `Continue with full verification` | escalation button |
| 1094 | _common | denied | `Verification failed. [N] attempt(s) remaining.` | attempts countdown |
| 1112 | _common | results | `Verified` | success heading |
| 1130–1141 | _common | results | feedback form strings | post-verification feedback |
| 1397–1407 | _common | escalation | action-reauth strings | action-reauth modal |

Note: vac-auth.js ceremony-flow strings are in the registry for reference; in-file migration is out of scope for v1 (the ceremony core in vac-reauth-ceremony.js is the primary migration target).

---

## K. tribunal-demo.html — Ceremony-flow strings (selected)

| LINE | TIER | STEP | STRING | NOTES |
|------|------|------|--------|-------|
| 1588 | quick | capture | `Starting quick check…` | button status (fast capture) |
| 1693–1740 | quick/full | results | renderReauthResult strings | reauth result display |

Note: tribunal-demo.html ceremony strings are in the registry for reference; in-file migration is out of scope for v1 (tribunal demo uses the ceremony via VACReauth.run(), so registry-correct copy flows through automatically for the migrated ceremony sites).

---

## Migration summary

### Sites migrated in this PR (vac-reauth-ceremony.js):
| Old string | Registry key |
|-----------|--------------|
| FAIL_REASONS.challenge_response.tip (line 286) | `[tier].denied.challenge_response_tip` |
| FAIL_REASONS.finger_gesture.tip (line 294) | `[tier].denied.finger_gesture_tip` |
| All other FAIL_REASONS entries (lines 267–300) | `_common.denied.*` |
| `'Say the greeting'` / `'Say the phrase'` (line 988) | `[tier].capture.phase_prompt_title` |
| `'SAY THE GREETING'` label (line 1000) | `[tier].capture.phase_prompt_finger_label` |
| `'Greeting heard'` (line 2828) | `[tier].capture.greeting_confirmed` |
| step2HeaderSub override — nameless (line 5445) | `nameless.preflight.header_sub` |
| combinedCaptureText override — nameless (line 5446) | `nameless.preflight.combined_capture_text` |
| step2HeaderSub override — quick/still (line 5450) | `quick.preflight.header_sub_still` |
| combinedCaptureText override — quick/still (line 5451) | `quick.preflight.combined_capture_text_still` |
| step2HeaderSub override — policy-no-voice (line 5455) | `full.preflight.header_sub_policy_no_voice` |
| combinedCaptureText override — policy-no-voice (line 5456) | `full.preflight.combined_capture_text_policy_no_voice` |

### Sites NOT migrated in v1 (tier-agnostic, no known bugs):
- AV preflight status labels (CAMERA ACTIVE, Requesting access…, mic/light pills)
- Progress/upload status strings
- Error recovery panel strings
- Modality description strings in results panel
- vac-auth.js ceremony strings
- tribunal-demo.html ceremony strings

### Known-wrong states corrected:
| Bug | Fix |
|-----|-----|
| line 286: challenge_response tip includes "the greeting" — wrong for nameless/quick | Registry has `nameless.denied.challenge_response_tip` (no greeting reference) and `quick.denied.challenge_response_tip` (no spoken phrase) |
| line 988: `'Say the greeting'` shows on nameless flow | Registry `nameless.capture.phase_prompt_title = 'Say the numbers'` |
| line 1000: `SAY THE GREETING` label shows on nameless flow | Registry `nameless.capture.phase_prompt_finger_label = 'SAY THE NUMBERS'` |
| line 2828: `'Greeting heard'` shows on nameless flow after user speaks digits | Registry `nameless.capture.greeting_confirmed = 'Numbers heard'` |
| lines 5445–5456: run() override strings hardcoded in-place | Moved to registry, ceremony reads via VACCopy.resolve() |
