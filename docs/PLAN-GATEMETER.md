# PLAN-GATEMETER — AGC Gate Meter UI (S139-GM)

## Data flow: AudioGateState → meter pixels

```
AudioGateState
├── ambientFloor  ─────────────────────► floor zone width  (0..ambientFloor/SCALE → 0..100%)
│                                        fill: #1E2536 (quiet) / #3A3350 (noisy)
│                                        hatch: 45° 1px  #2A2E42 (quiet) / #4A3A60 (noisy)
│                                        label 'background' shown when zone > 18% width
│
├── requiredThreshold ────────────────► gate tick X         (threshold/SCALE → 0..100%)
│                                        2px #C9A227 vertical, 'gate' label 9px mono above
│                                        draw-in: CSS scaleY 0→1 in 150ms on first render
│
├── liveLevel (UNSMOOTHED) ──────────► gate decision only  (voiced = liveLevel > threshold)
│       │                               L-2303: gate reads RAW, never the smoothed path
│       │
│       └── _gmDisplayLevel (smoothed) ► level bar width    (display only, rAF lerp)
│               attack α ≈ 0.284 (~50ms)    fill: #8B8FA3 (below gate) / #34D399 (above)
│               release α ≈ 0.054 (~300ms)
│
│           _gmPeakLevel / _gmPeakTs ──► peak tick X        (trails _gmDisplayLevel)
│                                        1px #E8E4D8, opacity 1→0 over 1.5s
│
└── noisy (bool) ────────────────────► warms floor fill + hint copy
                                        hint: 'It is noisy here — speak past the line'
```

Scale: `AGS_METER_SCALE = 0.45` (RMS 0.45 → 100% width, covers all practical voice levels)

## State enumeration

| State              | ambientFloor | liveLevel vs thr | noisy | Visual                                                  |
|--------------------|-------------|-------------------|----|--------------------------------------------------------------|
| quiet-idle         | low (~0.03)  | below            | false | floor ~7% dark; level bar near 0 steel; gate tick at ~15%   |
| noisy-idle         | high (>0.055)| below            | true  | floor wide warm #3A3350; coaching hint; gate tick pushed right|
| speaking-below-gate| low..mid    | below            | false | level bar steel extending, not yet at gate tick              |
| speaking-past-gate | any          | ABOVE            | any   | level bar green; gate tick crossed; peak tick trailing       |
| peak-decay         | any          | dropped back     | any   | peak tick visible at last peak X, opacity decaying to 0/1.5s |

## Geometry

```
y=0  ┌──────────────────────────────────────────────────────┐
     │ [background label, 9px mono, #8B8FA3 — floor zone]  │ ← only when zone >18%
y=9  │                      [gate, 9px mono, #C9A227]       │ ← text-anchor:middle over tick
y=11 │                      │ ← gate tick starts here (2px #C9A227)
y=12 ├──┬───────────────────┼──────────────────────────────┤
     │▓▓│ floor zone        │  headroom (dark track)       │ ← 8px track
y=14 │▓▓│  ▇▇▇▇▇ level bar (4px inset) ▐ │             ▐  │ ← level bar + peak tick
y=20 │▓▓│                   │              │              │ │
y=22 └──┴───────────────────┴──────────────────────────────┘
         ^ambientFloor%     ^threshold%   ^liveLevel%   ^peakLevel%
```

## Design decisions

- **Pure SVG**: all geometry is SVG (no emoji, no system icons). Pattern IDs `vacGMHatch` /
  `vacGMHatchN` pre-defined in `<defs>`. Pattern switches on `AudioGateState.noisy`. 
- **Coordinate system**: SVG `width="100%" height="22"`, no viewBox. User units = CSS pixels
  for y; percentage strings for x/width attributes (standard SVG 2.0). Pattern uses
  `patternUnits="userSpaceOnUse"` so hatch tiles at physical pixels regardless of container.
- **L-2303 dual-path**: `_gmDisplayLevel` is a module-scope smoothed copy derived from
  `AudioGateState.liveLevel`. The gate tick position and `voiced` color flag both read
  `AudioGateState.liveLevel` (unsmoothed). The visual bar reads `_gmDisplayLevel` only.
- **Placement**: meter wrapper `#vacGateMeter` inserted immediately after `#cameraBoxRec`
  (via `insertAdjacentElement('afterend', …)`), filling full parent width. This is the
  "video frame footer" — a strip directly below the camera box, not inside challengePanel.
- **Peak decay**: rAF-driven opacity (not CSS animation), so `prefers-reduced-motion` suppresses
  it via an explicit flag check in `_renderGateMeter`, not relying on the global CSS override.
- **Gate draw-in**: CSS `scaleY(0→1)` via class `vac-gm-gate-in`, suppressed at DOM-build time
  when `matchMedia('(prefers-reduced-motion: reduce)').matches` — no animation class applied.
- **Copy**: two keys in `VACCopy._common.capture`:
  - `gate_meter_background` → `'background'`
  - `gate_meter_noisy_hint` → `'It is noisy here — speak past the line'`
- **No deviations from spec**: all spec points satisfied as-written.

## Plan-design-review simulation (L-289)

| Criterion          | Assessment                                          | Pass? |
|--------------------|-----------------------------------------------------|-------|
| Signature element  | Gate tick is the sole high-contrast element (#C9A227) | ✓    |
| Geometry           | 8px track / 22px total / full video footer width    | ✓     |
| Layer order        | floor-fill → hatch → level → peak → gate (Z order) | ✓     |
| Ballistics         | Dual-path enforced at the read site, not by naming  | ✓     |
| Noisy state        | Warm fill + coaching hint via copy registry         | ✓     |
| Motion             | Draw-in 150ms + reduced-motion branch both coded    | ✓     |
| A11y               | role=meter, aria-valuemin/max/now on SVG root        | ✓     |
| Copy               | 2 keys through VACCopy, no inline English           | ✓     |
| No emoji/icons     | Pure SVG, no unicode codepoints in meter DOM         | ✓     |
