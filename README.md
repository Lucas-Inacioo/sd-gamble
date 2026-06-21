# Distributed Casino Demo

A classroom-oriented distributed-systems and human-computer interaction simulator with three games: **Crash**, **Mines**, and **Double**.

> **Academic use only.** The application uses demonstration credits only. It does not implement real money, payments, accounts, or gambling services.

## What changed in this organized version

- All React styles were moved out of JSX and into dedicated CSS files.
- Shared visual tokens, reusable components, and per-game styles are separated.
- Frontend components now use semantic class names instead of inline JavaScript style objects.
- Comments and JSDoc describe responsibilities, server authority, and relevant UI decisions.
- The Crash demo-bet payload is aligned with the backend event contract.

## Architecture

```text
Browser (React + Vite)
  ├─ REST: health, history and audit logs
  └─ Socket.IO: game actions and real-time events

Backend (Node.js + Express + Socket.IO)
  ├─ authoritatively generates and settles game outcomes
  └─ persists completed games and logs

Supabase PostgreSQL
  └─ crash_rounds, mines_games, double_rounds and audit_logs
```

The browser never receives the Crash point, Mines positions or Double result while a game is active. Those values remain on the backend until the game is complete.

## Project structure

```text
sd-gamble-organized/
├── backend/
│   └── src/
│       ├── index.js             # REST API, Socket.IO and game engine
│       └── db.js                # documented PostgreSQL access layer
├── interface/
│   └── src/
│       ├── App.jsx              # navigation shell
│       ├── components/
│       │   └── DebugPanels.jsx  # reusable Card, status and log components
│       ├── games/
│       │   ├── CrashGame.jsx
│       │   ├── MinesGame.jsx
│       │   └── DoubleGame.jsx
│       └── styles/
│           ├── tokens.css       # colors, spacing, radii and shadows
│           ├── global.css       # reset and accessible defaults
│           ├── app.css          # sidebar and responsive layout
│           ├── components.css   # reusable cards, buttons and form controls
│           ├── debug-panels.css # technical panel styles
│           ├── crash-game.css   # Crash-specific styles
│           ├── mines-game.css   # Mines-specific styles
│           ├── double-game.css  # Double-specific styles and animation
│           └── index.css        # central stylesheet entry point
├── supabase/schema.sql
└── docs/
    ├── CODE_ORGANIZATION.md
    └── UI_EVALUATION_NOTES.md
```

## Local execution

### 1. Configure the backend

Copy `backend/.env.example` to `backend/.env` and fill in your PostgreSQL connection information.

```bash
cp backend/.env.example backend/.env
```

### 2. Configure the interface

Copy `interface/.env.example` to `interface/.env`.

```bash
cp interface/.env.example interface/.env
```

For local development, the default interface URL is already correct:

```env
VITE_BACKEND_URL=http://localhost:4000
```

### 3. Install dependencies

```bash
npm run install:all
```

### 4. Run the services

Use two terminals at the repository root:

```bash
npm run dev:backend
```

```bash
npm run dev:web
```

Then open `http://localhost:5173`.

## Frontend style organization

Do not add new inline `style={{ ... }}` objects to React components. Prefer this order:

1. Reuse a class from `styles/components.css` for generic elements.
2. Add a game-specific class to the relevant `styles/<game>-game.css` file.
3. Add only reusable values to `styles/tokens.css`.

This keeps styling reviewable and makes later IHC changes easier to track between MVP versions.

## Validation performed

The organized frontend was validated with:

```bash
cd interface
npm ci
npm run build
```

The backend source was validated with:

```bash
node --check backend/src/index.js
node --check backend/src/db.js
```

## Deployment reminders

- Deploy `interface/` as a static Vite site.
- Deploy `backend/` as a persistent Node.js Web Service because Socket.IO needs a running process.
- Keep `DATABASE_URL` and all database credentials only in backend environment variables.
- Set `VITE_BACKEND_URL` to the backend public URL.
- Add the interface public URL to the backend `CORS_ORIGINS` variable without a trailing slash.

See [docs/CODE_ORGANIZATION.md](docs/CODE_ORGANIZATION.md) for implementation details.
