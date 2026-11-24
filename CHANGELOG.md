# Changelog

## [1.1.0] - 2026-11-24

### Added
- Adaptive performance controller (`src/game/performance.ts`) using a 30-frame rolling window of FPS, frame-time jitter, spikes, and CPU work time with hysteresis and cooldowns.
- Graphics quality presets (`Auto`, `High`, `Medium`, `Low`) with a HUD settings modal and `localStorage` persistence (`tmdash_quality_mode`), defaulting to `Auto`.
- Optional developer-only performance overlay (off for normal players; toggleable via `?perf=1`, `?debug=1`, `F3`, `Shift+D`, or 5 quick taps on the `TM DASH` title) displaying live FPS, average FPS, frame time, active quality level, and rendering scale.

### Improved
- **Mobile performance:** Added fixed-timestep (`1/60s`) physics accumulator, clamped frame deltas (`MAX_FRAME_DT = 0.1`), near-60Hz jitter snapping, and skipped renders on sub-steps to stabilize frame pacing on 60Hz, 90Hz, and 120Hz mobile displays.
- **Rendering efficiency:** Removed live `ctx.shadowBlur` and per-frame gradient allocations from hot loops; pre-rendered `2x` offscreen sprites (coins, character labels, `! SWING` badge, sun/moon coronas, beachball, umbrella), static sand/shell ground layers, and `Low`-quality palm sprites; switched Canvas 2D context to `{ alpha: false }`; capped mobile DPR (`1.5x` High, `1.25x` Medium, `1.0x` Low) with adaptive `0.78x` render scaling under sustained load; replaced expensive CSS `blur-[130px]` and `backdrop-blur-sm` filters.
- **Touch responsiveness:** Migrated stage and `JUMP` button input to Pointer Events with `pointerId` tracking and `touch-action: none`, eliminating `touchstart`/mouse duplicate jumps and the `90ms` debounce delay.
- **Browser compatibility:** Coalesced `resize`, `visualViewport.resize`, `ResizeObserver`, and `orientationchange` updates via `requestAnimationFrame`; added `100dvh` + safe-area inset handling and `overscroll-behavior: none`; handled iOS `'interrupted'` Web Audio state and auto-pause/suspend on `visibilitychange` and `pagehide`.

### Fixed
- Eliminated ~30/sec React state updates during active gameplay by updating HUD score and coin counters imperatively via DOM refs (`scoreDomRef`, `coinsDomRef`) while keeping JSX text static so mid-run day/night or quality updates cannot overwrite live counters.
- Prevented Web Audio `AudioContext` limit exhaustion across React StrictMode remounts by sharing a single reference-counted audio graph and disconnecting completed nodes on `onended`.
- Guarded `SoundManager.play()` cooldown checks against `undefined` timestamps in the first 200ms of page lifetime and prevented AI warning/swing/beep sounds from queuing before user gesture unlock.
- Hardened `localStorage` reads/writes against blocked storage and Safari Private Browsing without disrupting gameplay or existing `tmdash_best` and `tmdash_coins_total` data.
- Stopped background `requestAnimationFrame` loops cleanly on pause, visibility loss, and settled game-over states.

### Technical
- Replaced per-frame allocations in `GameEngine` with pre-allocated particle (`MAX_PARTICLES = 128`), obstacle, and coin pools compacted in place, reusable `StickGeometry` scratch coordinates, horizontal broad-phase collision culling, and full offscreen canvas/entity cleanup in `destroy()`.
- Removed the 1000ms `setInterval` polling `timeOfDay` in `TMDash.tsx` in favor of transition-only `onTimeOfDayChange` callbacks.
