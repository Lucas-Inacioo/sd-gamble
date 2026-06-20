import React, { useState } from "react";
import CrashGame from "./games/CrashGame.jsx";
import MinesGame from "./games/MinesGame.jsx";
import DoubleGame from "./games/DoubleGame.jsx";

export default function App() {
  const [selectedGame, setSelectedGame] = useState("crash");

  return (
    <main className="app-shell" style={styles.app}>
      <aside className="app-sidebar" style={styles.sidebar}>
        <h2 style={styles.logo}>Games</h2>
        <NavButton label="Crash" active={selectedGame === "crash"} onClick={() => setSelectedGame("crash")} />
        <NavButton label="Mines" active={selectedGame === "mines"} onClick={() => setSelectedGame("mines")} />
        <NavButton label="Double" active={selectedGame === "double"} onClick={() => setSelectedGame("double")} />
      </aside>
      <section className="app-content" style={styles.content}>
        {selectedGame === "crash" && <CrashGame />}
        {selectedGame === "mines" && <MinesGame />}
        {selectedGame === "double" && <DoubleGame />}
      </section>
    </main>
  );
}

function NavButton({ label, active, onClick }) {
  return (
    <button
      className="app-nav-button"
      style={{ ...styles.navButton, ...(active ? styles.activeButton : {}) }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    display: "flex",
    background: "#0d1117",
    color: "#e6edf3",
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: "#161b22",
    borderRight: "1px solid #30363d",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  logo: { margin: "0 0 20px" },
  navButton: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#e6edf3",
    cursor: "pointer",
    textAlign: "left",
    fontWeight: 700,
  },
  activeButton: {
    background: "#238636",
    borderColor: "#2ea043",
    color: "white",
  },
  content: {
    flex: 1,
    minWidth: 0,
    padding: 24,
  },
};
