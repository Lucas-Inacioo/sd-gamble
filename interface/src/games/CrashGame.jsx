import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { Card, DebugPanel, StatusBox, sharedStyles } from "../components/DebugPanels.jsx";

const CHART_WIDTH = 900;
const CHART_HEIGHT = 400;
const PADDING = 36;
const VISUAL_GROWTH_RATE = 0.06;
const MAX_POINTS = 450;

export default function CrashGame() {
  const socketRef = useRef(null);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [phase, setPhase] = useState("initial");
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [roundId, setRoundId] = useState(null);
  const [multiplier, setMultiplier] = useState(1);
  const [crashPoint, setCrashPoint] = useState(null);
  const [seedCommitment, setSeedCommitment] = useState(null);
  const [revealedProof, setRevealedProof] = useState(null);
  const [visualClock, setVisualClock] = useState(null);
  const [chartPoints, setChartPoints] = useState([{ t: 0, y: 1 }]);
  const [events, setEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [history, setHistory] = useState([]);

  // Demo-only wager state. The system has no real money or user wallet.
  const [betAmount, setBetAmount] = useState("10");
  const [autoCashout, setAutoCashout] = useState("2.00");
  const [bet, setBet] = useState(null);
  const [betMessage, setBetMessage] = useState(
    "Place a demo bet during the waiting phase. No real money is used."
  );

  useEffect(() => {
    loadApiData();
    const socket = io(GAME_SERVER_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      addEvent("socket_connected", { socketId: socket.id });
    });
    socket.on("connect_error", (error) => {
      setSocketStatus("connection error");
      addEvent("socket_connect_error", { message: error.message });
    });
    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
      addEvent("socket_disconnected", {});
    });
    socket.on("server_logs_snapshot", ({ logs = [] }) => {
      setServerLogs(logs.filter(isCrashOrSystem).slice(0, 12));
    });
    socket.on("game_server_log", (log) => {
      if (isCrashOrSystem(log)) setServerLogs((old) => [log, ...old].slice(0, 12));
    });
    socket.on("server_snapshot", (data) => {
      addEvent("server_snapshot", data);
      if (data.status === "active") {
        const offset = Number(data.elapsedSeconds || 0);
        const value = Number(data.multiplier || 1);
        setPhase("active");
        setRoundId(data.externalRoundId);
        setMultiplier(value);
        setCrashPoint(null);
        setSeedCommitment(data.serverSeedCommitment || null);
        setRevealedProof(null);
        setChartPoints([{ t: 0, y: 1 }, { t: offset, y: value }]);
        setVisualClock({ startedAt: performance.now(), offset });
      } else {
        setPhase(data.status || "initial");
        setSecondsLeft(data.secondsLeft ?? null);
      }
    });
    socket.on("round_waiting", (data) => {
      addEvent("round_waiting", data);
      setPhase("waiting");
      setSecondsLeft(data.secondsLeft);
      setRoundId(null);
      setMultiplier(1);
      setCrashPoint(null);
      setSeedCommitment(null);
      setRevealedProof(null);
      setChartPoints([{ t: 0, y: 1 }]);
      setVisualClock(null);
    });
    socket.on("round_started", (data) => {
      addEvent("round_started", data);
      setPhase("active");
      setSecondsLeft(null);
      setRoundId(data.externalRoundId);
      setMultiplier(1);
      setCrashPoint(null);
      setSeedCommitment(data.serverSeedCommitment || null);
      setRevealedProof(null);
      setChartPoints([{ t: 0, y: 1 }]);
      setVisualClock({ startedAt: performance.now(), offset: 0 });
    });
    socket.on("round_crashed", async (data) => {
      addEvent("round_crashed", data);
      const finalValue = Number(data.crashPoint);
      setVisualClock(null);
      setPhase("crashed");
      setCrashPoint(finalValue);
      setMultiplier(finalValue);
      setSeedCommitment(data.serverSeedCommitment || null);
      setRevealedProof({ serverSeed: data.serverSeed, publicSeed: data.publicSeed });
      setChartPoints((points) => [
        ...points.slice(-(MAX_POINTS - 1)),
        { t: Number(data.elapsedSeconds || points.at(-1)?.t || 0), y: finalValue },
      ]);
      await loadApiData();
    });

    socket.on("crash_bet_queued", (data) => {
      addEvent("crash_bet_queued", data);
      setBet(data);
      setBetMessage(
        `Demo bet of ${Number(data.amount).toFixed(2)} queued for the next round.`
      );
    });

    socket.on("crash_bet_started", (data) => {
      addEvent("crash_bet_started", data);
      setBet(data);
      setBetMessage(
        data.autoCashout
          ? `Bet active. Automatic cash out set to ${Number(data.autoCashout).toFixed(2)}x.`
          : "Bet active. Cash out manually before the server crashes the round."
      );
    });

    socket.on("crash_bet_cashed_out", (data) => {
      addEvent("crash_bet_cashed_out", data);
      setBet(data);
      setBetMessage(
        `${data.settlementType === "automatic" ? "Automatic" : "Manual"} cash out: ${Number(data.payout).toFixed(2)} demo credits.`
      );
    });

    socket.on("crash_bet_lost", (data) => {
      addEvent("crash_bet_lost", data);
      setBet(data);
      setBetMessage(
        `The round crashed at ${Number(data.crashPoint).toFixed(2)}x before this bet was cashed out.`
      );
    });

    socket.on("crash_bet_cancelled", (data) => {
      addEvent("crash_bet_cancelled", data);
      setBet(null);
      setBetMessage(`Queued bet of ${Number(data.amount).toFixed(2)} was cancelled.`);
    });

    socket.on("crash_error", (data) => {
      addEvent("crash_error", data);
      setBetMessage(data.message || "Crash bet error.");
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (phase !== "active" || !visualClock) return undefined;
    let frameId;
    const animate = () => {
      const elapsed = visualClock.offset + (performance.now() - visualClock.startedAt) / 1000;
      const value = Number(Math.exp(elapsed * VISUAL_GROWTH_RATE).toFixed(2));
      setMultiplier(value);
      setChartPoints((points) => [...points.slice(-(MAX_POINTS - 1)), { t: elapsed, y: value }]);
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [phase, visualClock]);

  async function loadApiData() {
    await Promise.all([fetchHistory(), fetchApiLogs(), checkHealth()]);
  }

  async function checkHealth() {
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
      const response = await fetch(`${API_BASE_URL}/api/rounds/history`);
      const data = await response.json();
      setHistory(data.rounds || []);
    } catch {
      setHistory([]);
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logs?game=crash&source=api`);
      const data = await response.json();
      setApiLogs(data.logs || []);
    } catch {
      setApiLogs([]);
    }
  }

  function addEvent(name, payload) {
    setEvents((old) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, payload }, ...old].slice(0, 12));
  }

  function placeDemoBet() {
    const amount = Number(betAmount);
    const auto = autoCashout.trim() === "" ? null : Number(autoCashout);

    if (phase !== "waiting") {
      setBetMessage("Wait for the next betting phase before placing a demo bet.");
      return;
    }

    if (!Number.isFinite(amount) || amount < 1) {
      setBetMessage("Enter a demo amount greater than or equal to 1.");
      return;
    }

    if (auto !== null && (!Number.isFinite(auto) || auto < 1.01)) {
      setBetMessage("Auto cash out must be empty or at least 1.01x.");
      return;
    }

    socketRef.current?.emit("crash_place_bet", {
      amount,
      autoCashout: auto,
    });
  }

  function cancelDemoBet() {
    socketRef.current?.emit("crash_cancel_bet");
  }

  function cashOutDemoBet() {
    socketRef.current?.emit("crash_cash_out");
  }

  const maxY = useMemo(() => Math.max(5, ...chartPoints.map((point) => point.y), multiplier, crashPoint || 1), [chartPoints, multiplier, crashPoint]);
  const maxT = useMemo(() => Math.max(30, ...chartPoints.map((point) => point.t)), [chartPoints]);
  const points = useMemo(() => chartPoints.map((point) => {
    const x = PADDING + (point.t / maxT) * (CHART_WIDTH - PADDING * 2);
    const progress = Math.min(1, Math.max(0, (point.y - 1) / (maxY - 1)));
    const y = CHART_HEIGHT - PADDING - progress * (CHART_HEIGHT - PADDING * 2);
    return `${x},${y}`;
  }).join(" "), [chartPoints, maxT, maxY]);
  const guideValues = Array.from(new Set([1, 2, 3, 4, Math.ceil(maxY)])).filter((value) => value <= Math.ceil(maxY));

  const hasQueuedBet = bet?.status === "queued";
  const hasActiveBet = bet?.status === "active";
  const canPlaceBet = phase === "waiting" && !hasQueuedBet;
  const canCashOut = phase === "active" && hasActiveBet;

  return (
    <div>
      <Card>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Crash</h1>
            <p style={styles.subtitle}>The graph is locally animated; the authoritative crash event comes from the server.</p>
          </div>
          <div style={styles.badges}>
            <Badge text={`Socket: ${socketStatus}`} />
            <Badge text={`API: ${apiStatus}`} />
            <Badge text={`Phase: ${phase}`} />
            <Badge text={`Knows crash: ${crashPoint === null ? "no" : "yes"}`} />
          </div>
        </div>
        <div style={styles.results}>
          <strong style={styles.muted}>Recent results</strong>
          {history.length === 0 && <span style={styles.muted}>No completed rounds yet.</span>}
          {history.slice(0, 12).map((round) => <span key={round.id} style={{ ...styles.pill, color: Number(round.crashPoint) >= 2 ? "#3fb950" : "#f85149" }}>{Number(round.crashPoint).toFixed(2)}x</span>)}
        </div>
      </Card>

      <Card>
        <div style={styles.betHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Play Crash (demo credits)</h2>
            <p style={styles.subtitle}>
              Place a bet during the waiting phase, then cash out before the authoritative server crash.
            </p>
          </div>
          <StatusBox
            label="Bet status"
            value={bet?.status || "none"}
          />
        </div>

        <div style={styles.betControls}>
          <label style={styles.inputLabel}>
            Demo amount
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={betAmount}
              disabled={phase !== "waiting" || hasQueuedBet}
              onChange={(event) => setBetAmount(event.target.value)}
              style={styles.input}
            />
          </label>

          <label style={styles.inputLabel}>
            Auto cash out (optional)
            <input
              type="number"
              min="1.01"
              max="100"
              step="0.01"
              placeholder="Manual cash out"
              value={autoCashout}
              disabled={phase !== "waiting" || hasQueuedBet}
              onChange={(event) => setAutoCashout(event.target.value)}
              style={styles.input}
            />
          </label>

          <div style={styles.betActions}>
            {canPlaceBet && (
              <button style={styles.primaryButton} onClick={placeDemoBet}>
                Place demo bet
              </button>
            )}

            {hasQueuedBet && phase === "waiting" && (
              <button style={styles.secondaryButton} onClick={cancelDemoBet}>
                Cancel queued bet
              </button>
            )}

            {canCashOut && (
              <button style={styles.cashOutButton} onClick={cashOutDemoBet}>
                Cash out at {multiplier.toFixed(2)}x
              </button>
            )}

            {phase === "active" && !hasActiveBet && (
              <span style={styles.muted}>Betting is closed for this round.</span>
            )}
          </div>
        </div>

        <p style={styles.betMessage}>{betMessage}</p>

        {bet && (
          <pre style={sharedStyles.pre}>
{JSON.stringify(
  {
    betId: bet.betId,
    status: bet.status,
    amount: bet.amount,
    autoCashout: bet.autoCashout,
    cashoutMultiplier: bet.cashoutMultiplier,
    payout: bet.payout,
    settlementType: bet.settlementType,
  },
  null,
  2
)}
          </pre>
        )}
      </Card>

      <Card>
        <div style={styles.chartBox}>
          <div style={styles.chartHud}>
            {phase === "waiting" && <div style={styles.waiting}>Next round starts in <strong>{secondsLeft}s</strong></div>}
            <div style={{ ...styles.multiplier, color: phase === "crashed" ? "#f85149" : phase === "active" ? "#3fb950" : "#e6edf3" }}>{multiplier.toFixed(2)}x</div>
            {phase === "active" && <div style={styles.active}>Smooth local visual; crash point remains hidden.</div>}
            {phase === "crashed" && <div style={styles.crashed}>Crashed at {crashPoint.toFixed(2)}x</div>}
          </div>
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} style={styles.chart}>
            <defs><linearGradient id="crashGradient" x1="0" x2="1"><stop offset="0%" stopColor="#2ea043" /><stop offset="100%" stopColor="#58a6ff" /></linearGradient></defs>
            <rect width={CHART_WIDTH} height={CHART_HEIGHT} rx="14" fill="#0d1117" />
            {guideValues.map((value) => {
              const progress = (value - 1) / (maxY - 1);
              const y = CHART_HEIGHT - PADDING - progress * (CHART_HEIGHT - PADDING * 2);
              return <g key={value}><line x1={PADDING} x2={CHART_WIDTH - PADDING} y1={y} y2={y} stroke="#30363d" strokeDasharray="6 8" /><text x="10" y={y + 4} fill="#8b949e" fontSize="12">{value.toFixed(2)}x</text></g>;
            })}
            <line x1={PADDING} x2={PADDING} y1={PADDING} y2={CHART_HEIGHT - PADDING} stroke="#6e7681" />
            <line x1={PADDING} x2={CHART_WIDTH - PADDING} y1={CHART_HEIGHT - PADDING} y2={CHART_HEIGHT - PADDING} stroke="#6e7681" />
            <polyline points={points} fill="none" stroke="url(#crashGradient)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </Card>

      <Card>
        <h2 style={styles.sectionTitle}>Current round data</h2>
        <pre style={sharedStyles.pre}>{JSON.stringify({ phase, roundId, multiplier, crashPoint, frontendKnowsCrashPoint: crashPoint !== null, seedCommitment, revealedProof, bet }, null, 2)}</pre>
      </Card>

      <div style={styles.columns}>
        <DebugPanel title="Socket events" items={events} eventMode />
        <HistoryPanel history={history} onRefresh={fetchHistory} />
        <DebugPanel title="Game server logs" items={serverLogs} />
        <DebugPanel title="API logs" items={apiLogs} onRefresh={fetchApiLogs} />
      </div>
    </div>
  );
}

function HistoryPanel({ history, onRefresh }) {
  return <Card><div style={styles.historyHeading}><h2 style={styles.sectionTitle}>Crash API history</h2><button style={sharedStyles.button} onClick={onRefresh}>Refresh</button></div>{history.length === 0 && <p style={styles.muted}>No records yet.</p>}{history.map((round) => <div key={round.id} style={styles.historyItem}><strong>{Number(round.crashPoint).toFixed(2)}x</strong><br /><span>{round.externalRoundId}</span><br /><small>{new Date(round.crashedAt).toLocaleString()}</small></div>)}</Card>;
}

function Badge({ text }) { return <span style={styles.badge}>{text}</span>; }
function isCrashOrSystem(log) { return log.game === "crash" || log.game === "system"; }

const styles = {
  header: { display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 32 },
  subtitle: { color: "#8b949e", margin: "8px 0 0" },
  badges: { display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start" },
  badge: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 999, padding: "8px 11px", fontSize: 13, fontWeight: 700 },
  results: { marginTop: 18, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  pill: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 999, padding: "7px 10px", fontWeight: 800 },
  muted: { color: "#8b949e" },
  chartBox: { position: "relative" },
  chartHud: { position: "absolute", inset: 0, zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", pointerEvents: "none", textAlign: "center" },
  waiting: { position: "absolute", top: 16, padding: "8px 12px", background: "rgba(13,17,23,0.88)", border: "1px solid #30363d", borderRadius: 999 },
  multiplier: { fontSize: "clamp(52px, 10vw, 90px)", fontWeight: 900, textShadow: "0 8px 24px rgba(0,0,0,.4)" },
  active: { marginTop: 10, padding: "8px 12px", borderRadius: 999, background: "rgba(13,17,23,.88)", color: "#3fb950", fontWeight: 700 },
  crashed: { marginTop: 10, padding: "8px 12px", borderRadius: 999, background: "rgba(13,17,23,.88)", color: "#f85149", fontWeight: 800 },
  chart: { display: "block", width: "100%", height: "auto", borderRadius: 14 },
  sectionTitle: { marginTop: 0 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 },
  historyHeading: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  historyItem: { borderTop: "1px solid #30363d", paddingTop: 12, marginTop: 12, overflowWrap: "anywhere" },
  betHeader: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  betControls: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, alignItems: "end", marginTop: 14 },
  inputLabel: { display: "flex", flexDirection: "column", gap: 7, color: "#8b949e", fontSize: 14, fontWeight: 700 },
  input: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, color: "#e6edf3", padding: "10px 12px", fontSize: 16 },
  betActions: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  primaryButton: { border: 0, borderRadius: 8, padding: "11px 14px", background: "#238636", color: "white", cursor: "pointer", fontWeight: 800 },
  secondaryButton: { border: "1px solid #30363d", borderRadius: 8, padding: "11px 14px", background: "#0d1117", color: "#e6edf3", cursor: "pointer", fontWeight: 800 },
  cashOutButton: { border: 0, borderRadius: 8, padding: "11px 14px", background: "#1f6feb", color: "white", cursor: "pointer", fontWeight: 800 },
  betMessage: { margin: "16px 0 0", padding: 12, borderRadius: 8, background: "#0d1117", border: "1px solid #30363d" },
};
