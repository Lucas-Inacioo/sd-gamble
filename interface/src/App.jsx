import React, { useState } from "react";
import CrashGame from "./games/CrashGame.jsx";
import MinesGame from "./games/MinesGame.jsx";
import DoubleGame from "./games/DoubleGame.jsx";

/**
 * Main application shell.
 *
 * The selected game is deliberately stored at this level because navigation is
 * a presentation concern. Each game owns only its own connection and state.
 */
export default function App() {
  const [selectedGame, setSelectedGame] = useState("crash");

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Game navigation">
        <h1 className="app-logo">Games</h1>

        <NavButton
          label="Crash"
          active={selectedGame === "crash"}
          onClick={() => setSelectedGame("crash")}
        />
        <NavButton
          label="Mines"
          active={selectedGame === "mines"}
          onClick={() => setSelectedGame("mines")}
        />
        <NavButton
          label="Double"
          active={selectedGame === "double"}
          onClick={() => setSelectedGame("double")}
        />
      </aside>

      <section className="app-content" aria-live="polite">
        {selectedGame === "crash" && <CrashGame />}
        {selectedGame === "mines" && <MinesGame />}
        {selectedGame === "double" && <DoubleGame />}
      </section>
    </main>
  );
}

/** Reusable navigation control with explicit current-page semantics. */
function NavButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={`app-nav-button${active ? " app-nav-button--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
