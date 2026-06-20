import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { Card, DebugPanel, StatusBox, sharedStyles } from "../components/DebugPanels.jsx";

const BOARD_SIZE = 25;

export default function MinesGame() {
  const socketRef = useRef(null);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [status, setStatus] = useState("idle");
  const [minesCount, setMinesCount] = useState(3);
  const [gameId, setGameId] = useState(null);
  const [revealedTiles, setRevealedTiles] = useState([]);
  const [minePositions, setMinePositions] = useState(null);
  const [payoutMultiplier, setPayoutMultiplier] = useState(1);
  const [seedCommitment, setSeedCommitment] = useState(null);
  const [proof, setProof] = useState(null);
  const [message, setMessage] = useState("Choose the number of mines and start a game.");
  const [events, setEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    loadApiData();
    const socket = io(GAME_SERVER_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => { setSocketStatus("connected"); addEvent("socket_connected", { socketId: socket.id }); });
    socket.on("connect_error", (error) => { setSocketStatus("connection error"); addEvent("socket_connect_error", { message: error.message }); });
    socket.on("disconnect", () => { setSocketStatus("disconnected"); addEvent("socket_disconnected", {}); });
    socket.on("server_logs_snapshot", ({ logs = [] }) => setServerLogs(logs.filter(isMinesOrSystem).slice(0, 12)));
    socket.on("game_server_log", (log) => { if (isMinesOrSystem(log)) setServerLogs((old) => [log, ...old].slice(0, 12)); });
    socket.on("mines_game_started", (data) => {
      addEvent("mines_game_started", data);
      setStatus("active"); setGameId(data.externalGameId); setRevealedTiles([]); setMinePositions(null); setPayoutMultiplier(1); setSeedCommitment(data.serverSeedCommitment); setProof(null); setMessage("Game active. Mine positions are hidden on the game server.");
    });
    socket.on("mines_tile_revealed", (data) => {
      addEvent("mines_tile_revealed", data);
      setRevealedTiles(data.revealedTiles || []); setPayoutMultiplier(Number(data.payoutMultiplier || 1)); setMessage("Safe tile revealed. Mine positions remain hidden.");
    });
    socket.on("mines_game_lost", async (data) => {
      addEvent("mines_game_lost", data);
      setStatus("lost"); setRevealedTiles(data.revealedTiles || []); setMinePositions(data.minePositions || []); setPayoutMultiplier(0); setProof({ serverSeed: data.serverSeed, publicSeed: data.publicSeed }); setMessage("A mine was found. The server revealed the full board."); await loadApiData();
    });
    socket.on("mines_game_cashed_out", async (data) => {
      addEvent("mines_game_cashed_out", data);
      setStatus(data.status || "cashed_out"); setRevealedTiles(data.revealedTiles || []); setMinePositions(data.minePositions || []); setPayoutMultiplier(Number(data.payoutMultiplier || 0)); setProof({ serverSeed: data.serverSeed, publicSeed: data.publicSeed }); setMessage(`Game finished at ${Number(data.payoutMultiplier || 0).toFixed(2)}x. The server revealed the board.`); await loadApiData();
    });
    socket.on("mines_error", (data) => { addEvent("mines_error", data); setMessage(data.message || "Mines error."); });
    return () => socket.disconnect();
  }, []);

  function startGame() { if (socketRef.current && status !== "active") socketRef.current.emit("mines_start_game", { minesCount }); }
  function revealTile(tileIndex) { if (status === "active" && !revealedTiles.includes(tileIndex)) socketRef.current?.emit("mines_reveal_tile", { tileIndex }); }
  function cashOut() { if (status === "active") socketRef.current?.emit("mines_cash_out"); }

  async function loadApiData() { await Promise.all([fetchHistory(), fetchApiLogs(), checkHealth()]); }
  async function checkHealth() { try { const r = await fetch(`${API_BASE_URL}/health`); const d = await r.json(); setApiStatus(d.ok ? "connected" : "error"); } catch { setApiStatus("disconnected"); } }
  async function fetchHistory() { try { const r = await fetch(`${API_BASE_URL}/api/mines/history`); const d = await r.json(); setHistory(d.games || []); } catch { setHistory([]); } }
  async function fetchApiLogs() { try { const r = await fetch(`${API_BASE_URL}/api/logs?game=mines&source=api`); const d = await r.json(); setApiLogs(d.logs || []); } catch { setApiLogs([]); } }
  function addEvent(name, payload) { setEvents((old) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, payload }, ...old].slice(0, 12)); }

  return <div>
    <Card>
      <h1 style={styles.title}>Mines</h1>
      <p style={styles.subtitle}>The interface requests a tile; the server owns the mine positions and validates each result.</p>
      <div style={styles.statusGrid}><StatusBox label="Game socket" value={socketStatus} /><StatusBox label="API" value={apiStatus} /><StatusBox label="Game status" value={status} /><StatusBox label="Knows mine positions?" value={minePositions ? "yes" : "no"} /></div>
    </Card>
    <Card>
      <div style={styles.controls}><label>Mine count <select value={minesCount} disabled={status === "active"} onChange={(e) => setMinesCount(Number(e.target.value))} style={styles.select}>{[1,2,3,5,7,10].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button style={styles.primary} disabled={status === "active"} onClick={startGame}>Start Mines</button><button style={styles.secondary} disabled={status !== "active" || revealedTiles.length === 0} onClick={cashOut}>Cash out ({payoutMultiplier.toFixed(2)}x)</button></div>
      <p style={styles.message}>{message}</p>
      <div style={styles.board}>{Array.from({ length: BOARD_SIZE }, (_, tileIndex) => { const revealed = revealedTiles.includes(tileIndex); const mine = minePositions?.includes(tileIndex); return <button key={tileIndex} disabled={status !== "active" || revealed} onClick={() => revealTile(tileIndex)} style={{ ...styles.tile, ...(revealed ? styles.safeTile : {}), ...(mine ? styles.mineTile : {}) }}>{mine ? "✹" : revealed ? "✓" : "?"}</button>; })}</div>
      <pre style={sharedStyles.pre}>{JSON.stringify({ status, gameId, minesCount, revealedTiles, minePositions, payoutMultiplier, seedCommitment, proof }, null, 2)}</pre>
    </Card>
    <div style={styles.columns}><DebugPanel title="Socket events" items={events} eventMode /><HistoryPanel history={history} onRefresh={fetchHistory} /><DebugPanel title="Game server logs" items={serverLogs} /><DebugPanel title="API logs" items={apiLogs} onRefresh={fetchApiLogs} /></div>
  </div>;
}

function HistoryPanel({ history, onRefresh }) { return <Card><div style={styles.historyHeading}><h2 style={styles.heading}>Mines API history</h2><button style={sharedStyles.button} onClick={onRefresh}>Refresh</button></div>{history.length === 0 && <p style={styles.muted}>No records yet.</p>}{history.map((game) => <div key={game.id} style={styles.historyItem}><strong>{game.status}</strong><br /><span>{game.minesCount} mines — {Number(game.payoutMultiplier).toFixed(2)}x</span><br /><small>{game.externalGameId}</small></div>)}</Card>; }
function isMinesOrSystem(log) { return log.game === "mines" || log.game === "system"; }

const styles = {
  title: { marginTop: 0, fontSize: 32 }, subtitle: { color: "#8b949e" }, statusGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }, controls: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }, select: { marginLeft: 8, background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3", borderRadius: 8, padding: 9 }, primary: { border: 0, borderRadius: 8, background: "#238636", color: "white", padding: "10px 14px", cursor: "pointer", fontWeight: 700 }, secondary: { border: "1px solid #30363d", borderRadius: 8, background: "#0d1117", color: "#e6edf3", padding: "10px 14px", cursor: "pointer", fontWeight: 700 }, message: { padding: 12, background: "#0d1117", borderRadius: 8, border: "1px solid #30363d" }, board: { display: "grid", gridTemplateColumns: "repeat(5, minmax(46px, 70px))", gap: 10, justifyContent: "start", margin: "18px 0" }, tile: { aspectRatio: "1", border: "1px solid #30363d", borderRadius: 10, background: "#21262d", color: "#e6edf3", fontSize: 20, cursor: "pointer", fontWeight: 900 }, safeTile: { background: "#238636" }, mineTile: { background: "#da3633" }, columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }, historyHeading: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }, heading: { margin: 0, fontSize: 20 }, muted: { color: "#8b949e" }, historyItem: { borderTop: "1px solid #30363d", paddingTop: 12, marginTop: 12, overflowWrap: "anywhere" },
};
