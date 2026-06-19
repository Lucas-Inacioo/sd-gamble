import React, { useState } from "react";
import CrashGame from "./games/CrashGame.jsx";
import MinesGame from "./games/MinesGame.jsx";

export default function App() {
  const [selectedGame, setSelectedGame] = useState("crash");

  return (
    <main style={styles.app}>
      <aside style={styles.sidebar}>
        <h2 style={styles.logo}>Games</h2>

        <button
          style={{
            ...styles.navButton,
            ...(selectedGame === "crash" ? styles.activeButton : {}),
          }}
          onClick={() => setSelectedGame("crash")}
        >
          Crash
        </button>

        <button
          style={{
            ...styles.navButton,
            ...(selectedGame === "mines" ? styles.activeButton : {}),
          }}
          onClick={() => setSelectedGame("mines")}
        >
          Mines
        </button>
      </aside>

      <section style={styles.content}>
        {selectedGame === "crash" && <CrashGame />}
        {selectedGame === "mines" && <MinesGame />}
      </section>
    </main>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    display: "flex",
    background: "#0d1117",
    color: "#e6edf3",
    fontFamily: "Arial, sans-serif",
  },
  sidebar: {
    width: 220,
    background: "#161b22",
    borderRight: "1px solid #30363d",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxSizing: "border-box",
  },
  logo: {
    margin: "0 0 20px 0",
  },
  navButton: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#e6edf3",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 16,
    fontWeight: 700,
  },
  activeButton: {
    background: "#238636",
    borderColor: "#2ea043",
    color: "white",
  },
  content: {
    flex: 1,
    padding: 24,
    boxSizing: "border-box",
    overflowX: "hidden",
  },
};
