# Frontend styles

All visual rules for the React interface are stored here.

- `tokens.css`: theme values shared by all screens.
- `global.css`: browser reset and focus behavior.
- `app.css`: sidebar and responsive application shell.
- `components.css`: reusable UI primitives.
- `debug-panels.css`: technical panels shown during the distributed-systems demonstration.
- `crash-game.css`, `mines-game.css`, `double-game.css`: screen-specific styles.
- `index.css`: the only style file imported by `main.jsx`.

Keep JSX focused on semantics, behavior and data. Add or edit CSS in this directory rather than creating inline React style objects.
