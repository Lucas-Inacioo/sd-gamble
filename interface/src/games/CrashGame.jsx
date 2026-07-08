import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { getPlayerId } from "../playerId.js";
import {
  Card,
  DebugPanel,
  StatusBox,
} from "../components/DebugPanels.jsx";
import CrashFlightVisual from "./CrashFlightVisual.jsx";

import "../styles/crash-game.css";

/**
 * Crash game screen.
 */
export default function CrashGame() {
  const socketRef = useRef(null);

  const lastLoggedMultiplierEventRef = useRef(0);

  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");

  const [phase, setPhase] = useState("initial");
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [roundId, setRoundId] = useState(null);

  const [multiplier, setMultiplier] = useState(1);

  const [crashPoint, setCrashPoint] = useState(null);
  const [seedCommitment, setSeedCommitment] = useState(null);
  const [revealedProof, setRevealedProof] = useState(null);

  const [events, setEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [history, setHistory] = useState([]);

  const [betAmount, setBetAmount] = useState("10");
  const [autoCashOut, setAutoCashOut] = useState("2.00");
  const [bet, setBet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [betMessage, setBetMessage] = useState(
    "Place a bet during the waiting phase."
  );

  /** Opens one Socket.IO connection and registers every Crash event. */
  useEffect(() => {
    loadApiData();

    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket", "polling"],
      auth: { playerId: getPlayerId() },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      addEvent("socket_connected", { socketId: socket.id });
    });

    socket.on("balance_update", (data) => {
      setBalance(Number(data.balance));
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
      setServerLogs(logs.filter(isCrashOrSystemLog).slice(0, 12));
    });

    socket.on("game_server_log", (log) => {
      if (isCrashOrSystemLog(log)) {
        setServerLogs((previousLogs) => [log, ...previousLogs].slice(0, 12));
      }
    });

    /** Synchronizes a browser that connects in the middle of a round. */
    socket.on("server_snapshot", (data) => {
      addEvent("server_snapshot", data);

      if (data.status === "active") {
        setPhase("active");
        setRoundId(data.externalRoundId || null);
        setMultiplier(Number(data.multiplier || 1));
        setCrashPoint(null);
        setSeedCommitment(data.serverSeedCommitment || null);
        setRevealedProof(null);
        return;
      }

      setPhase(data.status || "initial");
      setSecondsLeft(data.secondsLeft ?? null);
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

      // Keep a newly queued bet, but remove a previous settled bet.
      setBet((previousBet) =>
        previousBet?.status === "queued" ? previousBet : null
      );
    });

    socket.on("round_started", (data) => {
      addEvent("round_started", data);

      setPhase("active");
      setSecondsLeft(null);
      setRoundId(data.externalRoundId || null);
      setMultiplier(1);
      setCrashPoint(null);
      setSeedCommitment(data.serverSeedCommitment || null);
      setRevealedProof(null);
    });

    /**
     * This is the sole location where the visible live multiplier changes.
     * The decorative rocket follows it separately.
     */
    socket.on("multiplier_update", (data) => {
      const serverMultiplier = Number(data.multiplier);
      const elapsedSeconds = Number(data.elapsedSeconds);

      if (!Number.isFinite(serverMultiplier) || !Number.isFinite(elapsedSeconds)) {
        return;
      }

      setPhase("active");
      setRoundId(data.externalRoundId || null);
      setMultiplier(serverMultiplier);

      // Keep debug events understandable instead of logging every 100 ms update.
      const now = Date.now();
      if (now - lastLoggedMultiplierEventRef.current >= 750) {
        lastLoggedMultiplierEventRef.current = now;
        addEvent("multiplier_update", {
          externalRoundId: data.externalRoundId,
          multiplier: serverMultiplier,
          elapsedSeconds,
        });
      }
    });

    socket.on("round_crashed", async (data) => {
      addEvent("round_crashed", data);

      const finalValue = Number(data.crashPoint);

      setPhase("crashed");
      setCrashPoint(finalValue);
      setMultiplier(finalValue);
      setSeedCommitment(data.serverSeedCommitment || null);
      setRevealedProof({
        serverSeed: data.serverSeed,
        publicSeed: data.publicSeed,
      });

      await loadApiData();
    });

    // Demonstration bet events.
    socket.on("crash_bet_queued", (data) => {
      addEvent("crash_bet_queued", data);
      setBet(data);
      setBetMessage(
        `Bet of ${Number(data.amount).toFixed(2)} queued for the next round.`
      );
    });

    socket.on("crash_bet_started", (data) => {
      addEvent("crash_bet_started", data);
      setBet(data);
      setBetMessage(
        data.autoCashOut
          ? `Bet active. Automatic cash out set to ${Number(
              data.autoCashOut
            ).toFixed(2)}x.`
          : "Bet active. Cash out manually before the server crashes the round."
      );
    });

    socket.on("crash_bet_cashed_out", (data) => {
      addEvent("crash_bet_cashed_out", data);
      setBet(data);

      const label = data.source === "auto" ? "Automatic" : "Manual";
      setBetMessage(
        `${label} cash out: ${Number(data.payout || 0).toFixed(2)} demo credits.`
      );
    });

    socket.on("crash_bet_lost", (data) => {
      addEvent("crash_bet_lost", data);
      setBet(data);
      setBetMessage(
        `The round crashed at ${Number(data.crashPoint).toFixed(
          2
        )}x before this bet was cashed out.`
      );
    });

    socket.on("crash_bet_cancelled", (data) => {
      addEvent("crash_bet_cancelled", data);
      setBet(null);
      setBetMessage(
        `Queued bet of ${Number(data.amount).toFixed(2)} was cancelled.`
      );
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

  /** Loads the REST resources shown by the page. */
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
      const response = await fetch(
        `${API_BASE_URL}/api/logs?game=crash&source=api`
      );
      const data = await response.json();
      setApiLogs(data.logs || []);
    } catch {
      setApiLogs([]);
    }
  }

  /** Adds a compact technical event for debugging and demonstrations. */
  function addEvent(name, payload) {
    setEvents((previousEvents) =>
      [
        {
          id: createClientEventId(),
          createdAt: new Date().toISOString(),
          name,
          payload,
        },
        ...previousEvents,
      ].slice(0, 12)
    );
  }

  /** Sends a validated demo bet request to the backend. */
  function placeDemoBet() {
    const amount = Number(betAmount);
    const autoCashOutValue =
      autoCashOut.trim() === "" ? null : Number(autoCashOut);

    if (phase !== "waiting") {
      setBetMessage("Wait for the next betting phase before placing a demo bet.");
      return;
    }

    if (!Number.isFinite(amount) || amount < 1) {
      setBetMessage("Enter a demo amount greater than or equal to 1.");
      return;
    }

    if (balance !== null && amount > balance) {
      setBetMessage("Bet amount exceeds your current balance.");
      return;
    }

    if (
      autoCashOutValue !== null &&
      (!Number.isFinite(autoCashOutValue) || autoCashOutValue < 1.01)
    ) {
      setBetMessage("Auto cash out must be empty or at least 1.01x.");
      return;
    }

    socketRef.current?.emit("crash_place_bet", {
      amount,
      autoCashOut: autoCashOutValue,
    });
  }

  function cancelDemoBet() {
    socketRef.current?.emit("crash_cancel_bet");
  }

  function cashOutDemoBet() {
    socketRef.current?.emit("crash_cash_out");
  }

  const hasQueuedBet = bet?.status === "queued";
  const hasActiveBet = bet?.status === "active";
  const canPlaceBet = phase === "waiting" && !hasQueuedBet;
  const canCashOut = phase === "active" && hasActiveBet;

  return (
    <div className="crash-game">
      <Card>
        <h1 className="game-title">Crash</h1>

        <div className="status-grid">
          <StatusBox label="Game socket" value={socketStatus} />
          <StatusBox label="API" value={apiStatus} />
          <StatusBox label="Round status" value={phase} />
          <StatusBox
            label="Knows outcome?"
            value={crashPoint !== null ? "yes" : "no"}
          />
        </div>
      </Card>

      <Card>
        <div className="crash-bet-controls">
          <label className="form-label">
            Demo amount
            <input
              className="form-control"
              type="number"
              min="1"
              max="1000"
              step="1"
              value={betAmount}
              disabled={phase !== "waiting" || hasQueuedBet}
              onChange={(event) => setBetAmount(event.target.value)}
            />
          </label>

          <label className="form-label">
            Auto cash out (optional)
            <input
              className="form-control"
              type="number"
              min="1.01"
              max="100"
              step="0.01"
              placeholder="Manual cash out"
              value={autoCashOut}
              disabled={phase !== "waiting" || hasQueuedBet}
              onChange={(event) => setAutoCashOut(event.target.value)}
            />
          </label>

          <div className="crash-bet-actions">
            {canPlaceBet && (
              <button
                type="button"
                className="button button--primary"
                onClick={placeDemoBet}
              >
                Place demo bet
              </button>
            )}

            {hasQueuedBet && phase === "waiting" && (
              <button type="button" className="button" onClick={cancelDemoBet}>
                Cancel queued bet
              </button>
            )}

            {canCashOut && (
              <button
                type="button"
                className="button button--accent"
                onClick={cashOutDemoBet}
              >
                Cash out at {formatMultiplier(multiplier)}
              </button>
            )}

            {phase === "active" && !hasActiveBet && (
              <span className="muted-text">Betting is closed for this round.</span>
            )}
          </div>
        </div>

        <p className="message-box" aria-live="polite">
          {betMessage}
        </p>

        {bet && (
          <pre className="json-view">
            {JSON.stringify(
              {
                id: bet.id,
                status: bet.status,
                amount: bet.amount,
                autoCashOut: bet.autoCashOut,
                cashOutMultiplier: bet.cashOutMultiplier,
                payout: bet.payout,
              },
              null,
              2
            )}
          </pre>
        )}
      </Card>

      <Card>
        <CrashFlightVisual
          phase={phase}
          multiplier={multiplier}
          crashPoint={crashPoint}
          secondsLeft={secondsLeft}
          roundId={roundId}
        />
      </Card>

      <Card>
        <h2 className="section-heading">Current round data</h2>
        <pre className="json-view">
          {JSON.stringify(
            {
              phase,
              roundId,
              multiplier,
              crashPoint,
              frontendKnowsCrashPoint: crashPoint !== null,
              seedCommitment,
              revealedProof,
              bet,
            },
            null,
            2
          )}
        </pre>
      </Card>

      <div className="debug-grid">
        <DebugPanel title="Socket events" items={events} eventMode />
        <HistoryPanel history={history} onRefresh={fetchHistory} />
        <DebugPanel title="Game server logs" items={serverLogs} />
        <DebugPanel title="API logs" items={apiLogs} onRefresh={fetchApiLogs} />
      </div>
    </div>
  );
}

/** Displays persisted Crash results from the REST history endpoint. */
function HistoryPanel({ history, onRefresh }) {
  return (
    <Card>
      <div className="history-heading-row">
        <h2 className="section-heading">Crash API history</h2>
        <button type="button" className="button button--primary" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {history.length === 0 && <p className="muted-text">No records yet.</p>}

      {history.map((round) => (
        <article key={round.id} className="history-item">
          <strong>{formatMultiplier(round.crashPoint)}</strong>
          <br />
          <span>{round.externalRoundId}</span>
          <br />
          <small>{new Date(round.crashedAt).toLocaleString()}</small>
        </article>
      ))}
    </Card>
  );
}

function Badge({ text }) {
  return <span className="crash-badge">{text}</span>;
}

function isCrashOrSystemLog(log) {
  return log.game === "crash" || log.game === "system";
}

function formatMultiplier(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(2)}x` : "—";
}

function createClientEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}
