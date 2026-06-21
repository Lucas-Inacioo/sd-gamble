# Code organization guide

## Frontend responsibilities

The frontend is organized by responsibility rather than by one large JSX file.

| Location | Responsibility |
|---|---|
| `interface/src/App.jsx` | Application shell and game navigation. |
| `interface/src/components/DebugPanels.jsx` | Generic cards, status boxes and technical log panels. |
| `interface/src/games/CrashGame.jsx` | Crash state, Socket.IO events, demo bet controls and chart data. |
| `interface/src/games/MinesGame.jsx` | Mines board actions and server-driven reveal state. |
| `interface/src/games/DoubleGame.jsx` | Double choice controls, local reel animation and server outcome display. |
| `interface/src/styles/` | All visual presentation, separated by scope. |

## CSS files

### `tokens.css`
Contains variables such as colors, spacing, shadows and border radii. Add a token only when the value is reusable across more than one visual context.

### `global.css`
Contains the reset, the root font stack and keyboard focus styles. It should not contain game-specific selectors.

### `components.css`
Contains shared UI primitives: cards, buttons, form controls, status boxes, JSON/debug blocks and common layout grids.

### Game CSS files

`crash-game.css`, `mines-game.css`, and `double-game.css` contain only selectors for their respective screens. This reduces accidental visual changes across the project.

## Naming convention

CSS uses a readable component-oriented pattern:

```text
.component
.component__element
.component--modifier
```

Examples:

```text
.crash-result-pill
.crash-result-pill--safe
.double-ball
a.double-ball--spinning
```

## Event contract convention

Socket payload properties use camelCase. A new event should document:

1. event name;
2. direction: interface to backend or backend to interface;
3. expected payload;
4. which side is authoritative for the resulting state.

The current Crash bet contract is:

```text
Interface -> backend
- crash_place_bet { amount, autoCashOut }
- crash_cancel_bet
- crash_cash_out

Backend -> interface
- crash_bet_queued
- crash_bet_started
- crash_bet_cashed_out
- crash_bet_lost
- crash_bet_cancelled
- crash_error
```

## Safe extension rules

- Never move secret game outcomes to React state before the backend reveals them.
- Never add database credentials to `VITE_*` environment variables.
- Never use the client animation clock to settle a game outcome.
- Prefer a semantic HTML element and a CSS class before introducing generic `div` containers.
