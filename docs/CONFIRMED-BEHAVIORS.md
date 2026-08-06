# CONFIRMED BEHAVIORS — VAC Ceremony (S156)

> Source of truth: `tests/fixtures/confirmed/founding-rows.json`  
> Harness: `tests/confirmed-behaviors.test.js`  
> Anchored at: commit 22b2671 (task-644-mic-rms-zone-relax merged to main, 2026-08-06)

This document describes behaviors that have been confirmed correct at a specific source revision and
are protected by the fixture harness. Any change that touches a covered behavior must:

1. Add a new fixture row (bump `rev`) in `tests/fixtures/confirmed/founding-rows.json`
2. Update `calibration_block.sha256` if the calibration block changed
3. Run `node --test tests/confirmed-behaviors.test.js` and confirm all tests pass

---

## CB-MIC-01 — Time-domain RMS gate fires on normal speech

**Commit**: 22b2671 (task-644)  
**Defect fixed**: iOS Safari 26 returned ~0.01 from `getByteFrequencyData` during live speech (chip-level
frequency magnitude compression). Voice-band ratio was correct (100%) but the amplitude path was dead.

**Correct behavior**:
- All three VAD RMS compute sites use `getByteTimeDomainData` → `√mean((v-128)²)/128` (range 0–1)
- Normal speech reads 0.05–0.25 on this scale; ambient noise 0.005–0.025
- Fallback thresholds recalibrated to time-domain scale:
  - `VAD_SPEECH_RMS_FALLBACK = 0.085` (was 0.115 at freq-domain scale)
  - `VAD_SILENCE_RMS_FALLBACK = 0.030` (was 0.085)
  - `FAST_VAD_SPEECH_RMS = 0.085` (mirrors full-path fallback)
  - `FAST_VAD_SILENCE_RMS = 0.030`
- `getByteFrequencyData` remains in use for `voiceBandRatio` / spectral mid-band checks (unchanged)

**Calibration block**: The mic-preflight VAD calibration functions (`_CAL_K`, `_CAL_SIL_K`, `_CAL_MIN_SPAN`,
`_calClamp`, `FAST_CAL_FLOOR_MULT`, `FAST_CAL_THR_MIN`, `FAST_CAL_THR_MAX`, `_fastCalThreshold`,
`_micPreflightVad`) are bracketed by provenance markers in `vac-reauth-ceremony.js`:

```
// BEGIN CALIBRATION BLOCK (task-645)
...
// END CALIBRATION BLOCK (task-645)
```

The SHA256 of the block body is stored in `founding-rows.json` (`calibration_block.sha256`) and
verified by the CALIBRATION HASH GUARD test. Any change to the block (even a comment) will fail
that test until the fixture is updated with the new hash.

---

## CB-ZONE-01 — Beside-cheek pose accepted; hand-overlapping-face NOT required

**Commit**: 22b2671 (task-644)  
**Defect fixed**: `wrist(0.65,0.66)` accepted only with hand overlapping face; `wrist(0.72,0.78)` beside
cheek but not overlapping = OUT. Zone was too tight.

**Correct behavior**:
- `GESTURE_ZONE_SPEC.rx = 0.21` (was 0.17 — oval wider toward beside-cheek natural pose)
- `GESTURE_ZONE_SPEC.ry = 0.26` (was 0.22)
- `GESTURE_ZONE_SPEC.minTipsInside = 2` (was 3 — palm-centre OR 2 fingertips accepted)
- `_FACE_SIDE_GAP = 0.10` (was 0.03 — face-anchored ovals pushed further from face edge)

**Result**: Wrist beside cheek at (0.72, 0.78) with anchored face → ovals sit naturally beside (not on)
the face → IN. Hand overlapping face is no longer required.

---

## CB-ZONE-02 — Drawn guide and acceptance gate consume identical `_activeZone()` numbers

**Commit**: 22b2671 (task-644)  
**Property**: Single source of truth for zone geometry.

**Correct behavior**:
- `_ptInCheekZone(p)` (oval-intersection primitive) calls `_activeZone()` — the single live geometry source
- `_handNearFaceZone(lm)` (acceptance gate, gesture step) delegates to `_ptInCheekZone`
- `_drawFingerTargetGuide()` (pre-flight + quick-auth guide draw) calls `_activeZone()`
- `_avDrawHand()` (full-auth hand guide draw) calls `_activeZone()`
- Guide scale: `z.rx / GESTURE_ZONE_SPEC.rx` applied to `_activeZone()` output — guide is
  proportionally wider, but uses the same anchored oval centres

**Invariant**: The zone a user sees drawn on screen and the zone that registers acceptance are
computed from the same `_activeZone()` call. No separate constant path exists for either.

---

## Updating these fixtures

When a behavior in this document changes intentionally:

```bash
# 1. Make the source change
# 2. Recompute the calibration block SHA (if calibration block changed)
node -e "
const fs=require('fs'),crypto=require('crypto');
const src=fs.readFileSync('vac-reauth-ceremony.js','utf8');
const s=src.indexOf('// BEGIN CALIBRATION BLOCK (task-645)');
const e=src.indexOf('// END CALIBRATION BLOCK (task-645)');
const body=src.slice(src.indexOf('\n',s)+1,src.lastIndexOf('\n',e)).trim();
console.log(crypto.createHash('sha256').update(body).digest('hex'));
"
# 3. Update tests/fixtures/confirmed/founding-rows.json
#    - Add new row with bumped rev (keep old rows for history)
#    - Update calibration_block.sha256 if needed
# 4. Confirm tests pass
node --test tests/confirmed-behaviors.test.js
```
