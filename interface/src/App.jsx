import React, { useState } from "react";
import CrashGame from "./games/CrashGame.jsx";
import MinesGame from "./games/MinesGame.jsx";
import DoubleGame from "./games/DoubleGame.jsx";
import BalanceBar from "./components/BalanceBar.jsx";

/**
 * Main application shell.
 */
export default function App() {
  const [selectedGame, setSelectedGame] = useState("crash");

  return (
    <div className="app-root">
      <header className="app-topbar">
        <h1 className="app-logo">Games</h1>
        <BalanceBar />
      </header>

      <main className="app-shell">
        <aside className="app-sidebar" aria-label="Game navigation">
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
    </div>
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
