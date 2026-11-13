# TM Dash — Beach Endless Runner

A polished, mobile-friendly **2D endless runner** set on a neon tropical beach. Run as **TM**, jump over driftwood, rocks and rolling beach balls, grab coins, and survive the stick swings of **EFOT** and **DADA** while **HM** and **CM** cruise past on scooters.

Built with React 18, TypeScript, Vite, Tailwind CSS and a hand-written HTML Canvas 2D game engine. All art and audio are generated in code — there are no image or sound assets in the repo.

---

## Features

- **Auto-running character** with a double jump
- **Five obstacle types** — driftwood, rocks, rolling beach balls, sand mounds and beach umbrellas — each with its own hitbox shape
- **Collectible coins** in arcs, waves and stair patterns, with a per-coin score bonus
- **Progressive difficulty** — speed ramps gently from 4.0 to a capped 7.8, spawn gaps tighten as you go
- **Two AI chasers** (EFOT and DADA) who follow behind, telegraph with **! SWING**, and lunge with a stick you must jump over. Only one can attack at a time
- **Scooter riders** (HM and CM) who periodically cruise toward TM from the right, hop once over obstacles, and beep
- **Day/night cycle** — a continuous 76-second sunrise → day → sunset → night loop that repaints the sky, ocean, sand and palette
- **Full game flow** — start screen, pause/resume, game over with score / coins / best
- **Persistent stats** — best score and total coins in `localStorage` (`tmdash_best`, `tmdash_coins_total`), guarded against blocked storage
- **Procedural sound** via the Web Audio API (jump, coin, crash, warning, swing, whack, scooter horn), with a mute toggle
- **Mobile-first input** — tap anywhere on the stage or use the on-screen JUMP button; scrolling, pinch-zoom and callouts are suppressed while playing
- **Letterboxed canvas** — a fixed 900×360 virtual world scaled to fit any screen

---

## Characters

| Tag | Role | Behaviour |
| --- | --- | --- |
| **TM** | Player | Runs automatically, double jump, collects coins |
| **EFOT** | Chaser | Follows ~104px behind, lunges 54px to swing a stick |
| **DADA** | Chaser | Follows ~172px behind, lunges 102px to swing a stick |
| **HM** | Scooter rider | Oncoming teal scooter that hops over obstacles |
| **CM** | Scooter rider | Oncoming amber scooter that hops over obstacles |

---

## How to Play

| Action | Desktop | Mobile |
| --- | --- | --- |
| Jump | `Space` or `↑` | Tap the stage or the JUMP button |
| Double jump | Press again in mid-air | Tap again in mid-air |
| Pause / Resume | `P` or `Esc` | Pause button in the HUD |
| Start / Restart | `Enter` or click PLAY | Tap PLAY / PLAY AGAIN |

You get **two jumps per ground touch**. When a chaser shows **! SWING**, jump — the swing is dodged if you are airborne when it lands.

---

## Tech Stack

- **React 18 + TypeScript** — UI shell and screens
- **Vite 5** — dev server and build
- **Tailwind CSS 3** — styling
- **HTML Canvas 2D** — game rendering
- **Web Audio API** — procedural sound effects
- **lucide-react** — UI icons

---

## Getting Started

Requires **Node.js 18+**.

```bash
npm install       # install dependencies
npm run dev       # dev server on http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build into dist/
npm run preview    # preview the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

---

## Project Structure

```
public/
├── favicon.svg        # app icon
└── og-image.png       # social preview image (1200x630)

src/
├── game/
│   ├── engine.ts      # game loop, physics, AI, collisions, rendering
│   ├── sound.ts       # Web Audio sound manager
│   └── types.ts       # shared types
├── components/
│   └── TMDash.tsx     # React UI: screens, HUD, controls
├── App.tsx
├── main.tsx
└── index.css
```

---

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import it at [vercel.com](https://vercel.com).
3. Vercel auto-detects Vite — keep the defaults:
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
4. Deploy.

No `vercel.json` is required: the app is a single page at `/` with no client-side router, so there is nothing to rewrite and unknown paths correctly return 404.

---

## Browser Support

Any modern browser with Canvas 2D and Web Audio: Chrome, Edge, Firefox and Safari, on desktop and mobile. Audio starts after the first tap/click, as browsers require a user gesture.

---

## License

Original project — all graphics and sounds are generated in code. Free to use and modify.
