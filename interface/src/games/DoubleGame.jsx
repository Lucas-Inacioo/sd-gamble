import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { Card, DebugPanel, StatusBox, sharedStyles } from "../components/DebugPanels.jsx";

const NUMBERS = Array.from({ length: 15 }, (_, index) => index);

export default function DoubleGame() {
  const socketRef = useRef(null);
  const spinRef = useRef(null);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [status, setStatus] = useState("idle");
  const [selectedColor, setSelectedColor] = useState("red");
  const [visualNumber, setVisualNumber] = useState(0);
  const [round, setRound] = useState({ externalRoundId: null, resultNumber: null, resultColor: null, won: null, payoutMultiplier: 0, seedCommitment: null, proof: null });
  const [message, setMessage] = useState("Choose red, black, or green to begin.");
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
    socket.on("server_logs_snapshot", ({ logs = [] }) => setServerLogs(logs.filter(isDoubleOrSystem).slice(0, 12)));
    socket.on("game_server_log", (log) => { if (isDoubleOrSystem(log)) setServerLogs((old) => [log, ...old].slice(0, 12)); });
    socket.on("double_round_started", (data) => {
      addEvent("double_round_started", data);
      setStatus("spinning"); setSelectedColor(data.selectedColor); setRound({ externalRoundId: data.externalRoundId, resultNumber: null, resultColor: null, won: null, payoutMultiplier: 0, seedCommitment: data.serverSeedCommitment, proof: null }); setMessage("The reel is animated locally. The authoritative result is still hidden in the server."); startVisualSpin();
    });
    socket.on("double_round_finished", async (data) => {
      addEvent("double_round_finished", data); stopVisualSpin(Number(data.resultNumber)); setStatus("finished"); setRound({ externalRoundId: data.externalRoundId, resultNumber: Number(data.resultNumber), resultColor: data.resultColor, won: Boolean(data.won), payoutMultiplier: Number(data.payoutMultiplier || 0), seedCommitment: data.serverSeedCommitment, proof: { serverSeed: data.serverSeed, publicSeed: data.publicSeed } }); setMessage(data.won ? `You won ${Number(data.payoutMultiplier).toFixed(2)}x.` : `Result: ${data.resultColor} ${data.resultNumber}.`); await loadApiData();
    });
    socket.on("double_error", (data) => { addEvent("double_error", data); setMessage(data.message || "Double error."); });
    return () => { stopVisualSpin(); socket.disconnect(); };
  }, []);

  function startRound(color) { if (status !== "spinning") socketRef.current?.emit("double_start_round", { selectedColor: color }); }
  function startVisualSpin() { stopVisualSpin(); let number = Math.floor(Math.random() * 15); setVisualNumber(number); spinRef.current = setInterval(() => { number = (number + 1 + Math.floor(Math.random() * 4)) % 15; setVisualNumber(number); }, 70); }
  function stopVisualSpin(finalNumber) { if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; } if (Number.isInteger(finalNumber)) setVisualNumber(finalNumber); }
  async function loadApiData() { await Promise.all([fetchHistory(), fetchApiLogs(), checkHealth()]); }
  async function checkHealth() { try { const r = await fetch(`${API_BASE_URL}/health`); const d = await r.json(); setApiStatus(d.ok ? "connected" : "error"); } catch { setApiStatus("disconnected"); } }
  async function fetchHistory() { try { const r = await fetch(`${API_BASE_URL}/api/double/history`); const d = await r.json(); setHistory(d.rounds || []); } catch { setHistory([]); } }
  async function fetchApiLogs() { try { const r = await fetch(`${API_BASE_URL}/api/logs?game=double&source=api`); const d = await r.json(); setApiLogs(d.logs || []); } catch { setApiLogs([]); } }
  function addEvent(name, payload) { setEvents((old) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, payload }, ...old].slice(0, 12)); }

  const color = getColor(visualNumber);
  return <div>
    <style>{`@keyframes spinPulse { 0% { transform: scale(.9) rotate(-8deg) } 50% { transform: scale(1.08) rotate(8deg) } 100% { transform: scale(.9) rotate(-8deg) } }`}</style>
    <Card><h1 style={styles.title}>Double</h1><p style={styles.subtitle}>A local spin animation hides a result that remains authoritative on the game server.</p><div style={styles.statusGrid}><StatusBox label="Game socket" value={socketStatus} /><StatusBox label="API" value={apiStatus} /><StatusBox label="Round status" value={status} /><StatusBox label="Knows outcome?" value={round.resultNumber === null ? "no" : "yes"} /></div></Card>
    <Card><h2 style={styles.heading}>Choose a color</h2><div style={styles.choices}>{["red", "black", "green"].map((choice) => <button key={choice} disabled={status === "spinning"} onClick={() => startRound(choice)} style={{ ...styles.choice, background: colorHex(choice), ...(selectedColor === choice ? styles.selected : {}), ...(status === "spinning" ? styles.disabled : {}) }}><strong>{choice}</strong><span>{choice === "green" ? "14.00x" : "2.00x"}</span></button>)}</div><p style={styles.message}>{message}</p></Card>
    <Card><h2 style={styles.heading}>Number reel</h2><div style={styles.reel}><div style={{ ...styles.ball, background: colorHex(color), animation: status === "spinning" ? "spinPulse .18s linear infinite" : "none" }}>{visualNumber}</div><strong>{status === "spinning" ? "Spinning locally — server outcome hidden" : round.resultNumber === null ? "Choose a color" : `Server result: ${round.resultColor} ${round.resultNumber}`}</strong></div><div style={styles.numbers}>{NUMBERS.map((number) => <span key={number} style={{ ...styles.number, background: colorHex(getColor(number)), ...(number === visualNumber ? styles.currentNumber : {}), ...(number === round.resultNumber ? styles.resultNumber : {}) }}>{number}</span>)}</div><pre style={sharedStyles.pre}>{JSON.stringify({ status, selectedColor, visualNumber, frontendKnowsOutcome: round.resultNumber !== null, ...round }, null, 2)}</pre></Card>
    <div style={styles.columns}><DebugPanel title="Socket events" items={events} eventMode /><HistoryPanel history={history} onRefresh={fetchHistory} /><DebugPanel title="Game server logs" items={serverLogs} /><DebugPanel title="API logs" items={apiLogs} onRefresh={fetchApiLogs} /></div>
  </div>;
}

function getColor(number) { return number === 0 ? "green" : number <= 7 ? "red" : "black"; }
function colorHex(color) { return color === "red" ? "#da3633" : color === "green" ? "#238636" : "#21262d"; }
function isDoubleOrSystem(log) { return log.game === "double" || log.game === "system"; }
function HistoryPanel({ history, onRefresh }) { return <Card><div style={styles.historyHeading}><h2 style={styles.heading}>Double API history</h2><button style={sharedStyles.button} onClick={onRefresh}>Refresh</button></div>{history.length === 0 && <p style={styles.muted}>No records yet.</p>}{history.map((round) => <div key={round.id} style={styles.historyItem}><strong style={{ color: colorHex(round.resultColor) }}>{round.resultColor} {round.resultNumber}</strong><br /><span>selected: {round.selectedColor} — {round.won ? "won" : "lost"}</span><br /><small>{round.externalRoundId}</small></div>)}</Card>; }

const styles = {
  title: { marginTop: 0, fontSize: 32 }, subtitle: { color: "#8b949e" }, heading: { marginTop: 0, fontSize: 20 }, statusGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }, choices: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }, choice: { minHeight: 82, color: "white", border: "2px solid rgba(255,255,255,.25)", borderRadius: 12, cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, justifyContent: "center", fontSize: 18, textTransform: "capitalize" }, selected: { boxShadow: "0 0 0 3px #58a6ff" }, disabled: { opacity: .55, cursor: "not-allowed" }, message: { padding: 12, background: "#0d1117", border: "1px solid #30363d", borderRadius: 8 }, reel: { minHeight: 220, background: "#0d1117", border: "1px solid #30363d", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center" }, ball: { width: 118, height: 118, borderRadius: "50%", border: "5px solid rgba(255,255,255,.3)", display: "grid", placeItems: "center", fontSize: 56, fontWeight: 900 }, numbers: { display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0" }, number: { width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", color: "white", border: "1px solid rgba(255,255,255,.25)", fontWeight: 800 }, currentNumber: { boxShadow: "0 0 0 3px #58a6ff", transform: "scale(1.1)" }, resultNumber: { boxShadow: "0 0 0 3px white" }, columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }, historyHeading: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }, muted: { color: "#8b949e" }, historyItem: { borderTop: "1px solid #30363d", paddingTop: 12, marginTop: 12, overflowWrap: "anywhere" },
};
