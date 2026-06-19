import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const GAME_SERVER_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:4000";
const BOARD_SIZE = 25;

export default function MinesGame() {
  const [socket, setSocket] = useState(null);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [status, setStatus] = useState("idle");
  const [minesCount, setMinesCount] = useState(3);
  const [externalGameId, setExternalGameId] = useState(null);
  const [revealedTiles, setRevealedTiles] = useState([]);
  const [minePositions, setMinePositions] = useState(null);
  const [payoutMultiplier, setPayoutMultiplier] = useState(1.0);
  const [serverSeedCommitment, setServerSeedCommitment] = useState(null);
  const [serverSeed, setServerSeed] = useState(null);
  const [publicSeed, setPublicSeed] = useState(null);
  const [message, setMessage] = useState("Start a game, then pick safe tiles.");
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [gameServerLogs, setGameServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);

  useEffect(() => {
    checkApi();
    fetchHistory();
    fetchApiLogs();

    const socketClient = io(GAME_SERVER_URL, { transports: ["websocket", "polling"] });
    setSocket(socketClient);

    socketClient.on("connect", () => {
      setSocketStatus("connected");
      addEvent("socket_connected", { socketId: socketClient.id });
    });

    socketClient.on("connect_error", (error) => {
      setSocketStatus("connection error");
      addEvent("socket_connect_error", { message: error.message });
    });

    socketClient.on("disconnect", () => {
      setSocketStatus("disconnected");
      addEvent("socket_disconnected", {});
    });

    socketClient.on("server_logs_snapshot", (data) => {
      setGameServerLogs((data.logs || []).filter(isMinesOrSystem).slice(0, 12));
    });

    socketClient.on("game_server_log", (log) => {
      if (isMinesOrSystem(log)) setGameServerLogs((oldLogs) => [log, ...oldLogs].slice(0, 12));
    });

    socketClient.on("mines_game_started", (data) => {
      addEvent("mines_game_started", data);
      setStatus("active");
      setExternalGameId(data.externalGameId);
      setRevealedTiles([]);
      setMinePositions(null);
      setPayoutMultiplier(Number(data.payoutMultiplier || 1));
      setServerSeedCommitment(data.serverSeedCommitment || null);
      setServerSeed(null);
      setPublicSeed(null);
      setMessage("Game active. Mine positions are hidden in the game server.");
    });

    socketClient.on("mines_tile_revealed", (data) => {
      addEvent("mines_tile_revealed", data);
      setRevealedTiles(data.revealedTiles || []);
      setPayoutMultiplier(Number(data.payoutMultiplier || 1));
      setMessage(`Safe tile. Current payout: ${Number(data.payoutMultiplier).toFixed(2)}x`);
    });

    socketClient.on("mines_game_lost", async (data) => {
      addEvent("mines_game_lost", data);
      applyFinishedGame(data);
      setMessage(`You hit a mine at tile ${data.selectedTile + 1}. Game over.`);
      await fetchHistory();
      await fetchApiLogs();
    });

    socketClient.on("mines_game_cashed_out", async (data) => {
      addEvent("mines_game_cashed_out", data);
      applyFinishedGame(data);
      setMessage(`Game finished with payout ${Number(data.payoutMultiplier).toFixed(2)}x.`);
      await fetchHistory();
      await fetchApiLogs();
    });

    socketClient.on("mines_error", (data) => {
      addEvent("mines_error", data);
      setMessage(data.message || "Mines error.");
    });

    return () => socketClient.disconnect();
  }, []);

  function startGame() {
    if (!socket) return;
    socket.emit("mines_start_game", { minesCount: Number(minesCount) });
  }

  function revealTile(tileIndex) {
    if (!socket || status !== "active") return;
    if (revealedTiles.includes(tileIndex)) return;
    socket.emit("mines_reveal_tile", { tileIndex });
  }

  function cashOut() {
    if (!socket) return;
    socket.emit("mines_cash_out");
  }

  function applyFinishedGame(data) {
    setStatus(data.status || "finished");
    setExternalGameId(data.externalGameId);
    setRevealedTiles(data.revealedTiles || []);
    setMinePositions(data.minePositions || []);
    setPayoutMultiplier(Number(data.payoutMultiplier || 0));
    setServerSeed(data.serverSeed || null);
    setPublicSeed(data.publicSeed || null);
    setServerSeedCommitment(data.serverSeedCommitment || null);
  }

  async function checkApi() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      const data = await response.json();
      setApiStatus(data.ok ? "connected" : "error");
    } catch {
      setApiStatus("disconnected");
    }
  }

  async function fetchHistory() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/mines/history`);
      const data = await response.json();
      if (data.success) {
        setHistory(data.games || []);
        setApiStatus("connected");
      }
    } catch {
      setApiStatus("disconnected");
      setHistory([]);
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logs?game=mines`);
      const data = await response.json();
      if (data.success) setApiLogs(data.logs || []);
    } catch {
      setApiLogs([]);
    }
  }

  function addEvent(name, payload) {
    setEvents((oldEvents) => [
      { id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), name, payload },
      ...oldEvents,
    ].slice(0, 12));
  }

  const frontendKnowsMinePositions = Array.isArray(minePositions);

  return (
    <div>
      <section style={styles.card}>
        <h1>Mines</h1>
        <div style={styles.statusGrid}>
          <StatusBox label="Game Socket" value={socketStatus} />
          <StatusBox label="API" value={apiStatus} />
          <StatusBox label="Game Status" value={status} />
          <StatusBox label="Knows Mines?" value={frontendKnowsMinePositions ? "yes" : "no"} />
        </div>
      </section>

      <section style={styles.card}>
        <h2>Controls</h2>
        <div style={styles.controls}>
          <label style={styles.label}>
            Mines
            <input
              style={styles.input}
              type="number"
              min="1"
              max="24"
              value={minesCount}
              disabled={status === "active"}
              onChange={(event) => setMinesCount(event.target.value)}
            />
          </label>
          <button style={styles.button} onClick={startGame}>Start New Game</button>
          <button style={styles.buttonSecondary} onClick={cashOut} disabled={status !== "active" || revealedTiles.length === 0}>Cash Out</button>
        </div>
        <p>{message}</p>
      </section>

      <section style={styles.card}>
        <h2>Board</h2>
        <p>Payout multiplier: <strong>{Number(payoutMultiplier).toFixed(2)}x</strong></p>
        <div style={styles.board}>
          {Array.from({ length: BOARD_SIZE }).map((_, index) => {
            const revealed = revealedTiles.includes(index);
            const isMine = frontendKnowsMinePositions && minePositions.includes(index);
            return (
              <button
                key={index}
                style={{ ...styles.tile, ...(revealed ? styles.safeTile : {}), ...(isMine ? styles.mineTile : {}) }}
                onClick={() => revealTile(index)}
                disabled={status !== "active" || revealed}
              >
                {isMine ? "💣" : revealed ? "✓" : "?"}
              </button>
            );
          })}
        </div>
        <pre style={styles.pre}>{JSON.stringify({ status, externalGameId, minesCount: Number(minesCount), revealedTiles, minePositions, payoutMultiplier, frontendKnowsMinePositions, serverSeedCommitment, serverSeed, publicSeed }, null, 2)}</pre>
      </section>

      <section style={styles.columns}>
        <LogPanel title="Socket Events" items={events} kind="event" />
        <MinesHistoryPanel history={history} onRefresh={fetchHistory} />
        <LogPanel title="Game Server Logs" items={gameServerLogs} kind="server" />
        <LogPanel title="API Logs" items={apiLogs} kind="api" onRefresh={fetchApiLogs} />
      </section>
    </div>
  );
}

function isMinesOrSystem(log) {
  return log.game === "mines" || log.game === "system";
}

function StatusBox({ label, value }) {
  const good = value === "running" || value === "connected" || value === "active" || value === "no";
  const bad = value === "disconnected" || value === "connection error" || value === "error" || value === "lost";
  return <div style={styles.statusBox}><span>{label}</span><strong style={{ color: good ? "#3fb950" : bad ? "#f85149" : "#d29922" }}>{value}</strong></div>;
}

function MinesHistoryPanel({ history, onRefresh }) {
  return (
    <div style={styles.card}>
      <h2>Mines API History</h2>
      <button style={styles.button} onClick={onRefresh}>Refresh</button>
      {history.length === 0 && <p>No completed mines games stored yet.</p>}
      {history.map((game) => (
        <div key={game.id} style={styles.historyItem}>
          <strong>{game.status} — {Number(game.payoutMultiplier).toFixed(2)}x</strong><br />
          <span>{game.externalGameId}</span><br />
          <small>mines: {game.minesCount}, revealed: {game.revealedTiles.length}</small>
        </div>
      ))}
    </div>
  );
}

function LogPanel({ title, items, kind, onRefresh }) {
  return (
    <div style={styles.card}>
      <h2>{title}</h2>
      {onRefresh && <button style={styles.button} onClick={onRefresh}>Refresh</button>}
      {items.length === 0 && <p>No logs yet.</p>}
      {items.map((item) => (
        <div key={item.id} style={styles.event}>
          <strong>{item.time || new Date(item.createdAt).toLocaleTimeString()} — {item.name || item.event}</strong>
          <pre style={styles.smallPre}>{JSON.stringify(kind === "event" ? item.payload : item.details, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

const styles = {
  card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 20, marginBottom: 20 },
  statusGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 20 },
  statusBox: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  controls: { display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 },
  input: { background: "#0d1117", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "10px 12px", width: 90 },
  button: { background: "#238636", color: "white", border: 0, borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 700, marginBottom: 8 },
  buttonSecondary: { background: "#8957e5", color: "white", border: 0, borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 700, marginBottom: 8 },
  board: { display: "grid", gridTemplateColumns: "repeat(5, 64px)", gap: 10, margin: "20px 0" },
  tile: { width: 64, height: 64, borderRadius: 8, border: "1px solid #30363d", background: "#21262d", color: "white", fontSize: 24, cursor: "pointer" },
  safeTile: { background: "#238636" },
  mineTile: { background: "#da3633" },
  pre: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 10, padding: 12, overflowX: "auto" },
  smallPre: { background: "#0d1117", borderRadius: 8, padding: 8, fontSize: 12, overflowX: "auto" },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 },
  event: { borderTop: "1px solid #30363d", marginTop: 12, paddingTop: 12 },
  historyItem: { borderTop: "1px solid #30363d", marginTop: 12, paddingTop: 12, wordBreak: "break-all" },
};
