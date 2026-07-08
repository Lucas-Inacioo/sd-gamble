import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { getPlayerId } from "../playerId.js";
import { Card, DebugPanel, StatusBox } from "../components/DebugPanels.jsx";

const NUMBERS = Array.from({ length: 15 }, (_, index) => index);
const DOUBLE_COLORS = ["red", "black", "green"];

/**
 * Double game screen.
 *
 * The spinning reel is a client-side animation for smooth feedback. The actual
 * number remains hidden until the backend emits `double_round_finished`.
 */
export default function DoubleGame() {
  const socketRef = useRef(null);
  const spinIntervalRef = useRef(null);

  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [status, setStatus] = useState("idle");
  const [selectedColor, setSelectedColor] = useState("red");
  const [visualNumber, setVisualNumber] = useState(0);
  const [round, setRound] = useState(createEmptyRound());
  const [betAmount, setBetAmount] = useState("10");
  const [balance, setBalance] = useState(null);
  const [message, setMessage] = useState(
    "Choose a bet amount and a color to begin."
  );

  const [events, setEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [history, setHistory] = useState([]);

  /** Connects to the game backend and subscribes to Double events. */
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
      setServerLogs(logs.filter(isDoubleOrSystemLog).slice(0, 12));
    });

    socket.on("game_server_log", (log) => {
      if (isDoubleOrSystemLog(log)) {
        setServerLogs((previousLogs) => [log, ...previousLogs].slice(0, 12));
      }
    });

    socket.on("double_round_started", (data) => {
      addEvent("double_round_started", data);
      setStatus("spinning");
      setSelectedColor(data.selectedColor);
      setRound({
        externalRoundId: data.externalRoundId,
        amount: Number(data.amount || 0),
        payout: 0,
        resultNumber: null,
        resultColor: null,
        won: null,
        payoutMultiplier: 0,
        seedCommitment: data.serverSeedCommitment,
        proof: null,
      });
      setMessage(
        "Playing local animation, waiting for server result..."
      );
      startVisualSpin();
    });

    socket.on("double_round_finished", async (data) => {
      addEvent("double_round_finished", data);
      stopVisualSpin(Number(data.resultNumber));
      setStatus("finished");
      setRound({
        externalRoundId: data.externalRoundId,
        amount: Number(data.amount || 0),
        payout: Number(data.payout || 0),
        resultNumber: Number(data.resultNumber),
        resultColor: data.resultColor,
        won: Boolean(data.won),
        payoutMultiplier: Number(data.payoutMultiplier || 0),
        seedCommitment: data.serverSeedCommitment,
        proof: {
          serverSeed: data.serverSeed,
          publicSeed: data.publicSeed,
        },
      });
      setMessage(
        data.won
          ? `You won ${Number(data.payoutMultiplier).toFixed(2)}x (${Number(
              data.payout || 0
            ).toFixed(2)} credits).`
          : `Result: ${data.resultColor} ${data.resultNumber}.`
      );
      await loadApiData();
    });

    socket.on("double_error", (data) => {
      addEvent("double_error", data);
      setMessage(data.message || "Double error.");
    });

    return () => {
      stopVisualSpin();
      socketRef.current = null;
      socket.disconnect();
    };
  }, []);

  /** Sends the selected color and bet amount to the server if no other round is spinning. */
  function startRound(color) {
    if (status === "spinning") return;

    const amount = Number(betAmount);
    if (!Number.isFinite(amount) || amount < 1) {
      setMessage("Enter a bet amount greater than or equal to 1.");
      return;
    }

    if (balance !== null && amount > balance) {
      setMessage("Bet amount exceeds your current balance.");
      return;
    }

    socketRef.current?.emit("double_start_round", {
      selectedColor: color,
      amount,
    });
  }

  /** Starts the presentation-only spinning effect. */
  function startVisualSpin() {
    stopVisualSpin();

    let nextNumber = Math.floor(Math.random() * NUMBERS.length);
    setVisualNumber(nextNumber);

    spinIntervalRef.current = setInterval(() => {
      nextNumber =
        (nextNumber + 1 + Math.floor(Math.random() * 4)) % NUMBERS.length;
      setVisualNumber(nextNumber);
    }, 70);
  }

  /** Stops the visual effect and optionally places the server-provided result. */
  function stopVisualSpin(finalNumber) {
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    if (Number.isInteger(finalNumber)) {
      setVisualNumber(finalNumber);
    }
  }

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
      const response = await fetch(`${API_BASE_URL}/api/double/history`);
      const data = await response.json();
      setHistory(data.rounds || []);
    } catch {
      setHistory([]);
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/logs?game=double&source=api`
      );
      const data = await response.json();
      setApiLogs(data.logs || []);
    } catch {
      setApiLogs([]);
    }
  }

  function addEvent(name, payload) {
    setEvents((previousEvents) => [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        name,
        payload,
      },
      ...previousEvents,
    ].slice(0, 12));
  }

  const visualColor = getDoubleColor(visualNumber);

  return (
    <div className="double-game">
      <Card>
        <h1 className="game-title">Double</h1>

        <div className="status-grid">
          <StatusBox label="Game socket" value={socketStatus} />
          <StatusBox label="API" value={apiStatus} />
          <StatusBox label="Round status" value={status} />
          <StatusBox
            label="Knows outcome?"
            value={round.resultNumber === null ? "no" : "yes"}
          />
        </div>
      </Card>

      <Card>
        <h2 className="section-heading">Choose a color</h2>

        <label className="form-label">
          Bet amount
          <input
            className="form-control"
            type="number"
            min="1"
            max="10000"
            step="1"
            value={betAmount}
            disabled={status === "spinning"}
            onChange={(event) => setBetAmount(event.target.value)}
          />
        </label>

        <br />

        <div className="double-choices">
          {DOUBLE_COLORS.map((choice) => (
            <button
              key={choice}
              type="button"
              className={[
                "double-choice",
                `double-choice--${choice}`,
                selectedColor === choice && "double-choice--selected",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={status === "spinning"}
              onClick={() => startRound(choice)}
            >
              <strong>{choice}</strong>
              <span>{choice === "green" ? "14.00x" : "2.00x"}</span>
            </button>
          ))}
        </div>

        <p className="message-box" aria-live="polite">
          {message}
        </p>
      </Card>

      <Card>
        <h2 className="section-heading">Number reel</h2>

        <div className="double-reel">
          <div
            className={[
              "double-ball",
              `double-ball--${visualColor}`,
              status === "spinning" && "double-ball--spinning",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`Current visual number: ${visualNumber}`}
          >
            {visualNumber}
          </div>

          <strong>
            {status === "spinning"
              ? "Spinning - server outcome hidden"
              : round.resultNumber === null
                ? "Choose a color"
                : `Server result: ${round.resultColor} ${round.resultNumber}`}
          </strong>
        </div>

        <div className="double-numbers" aria-label="Double result track">
          {NUMBERS.map((number) => {
            const numberColor = getDoubleColor(number);
            return (
              <span
                key={number}
                className={[
                  "double-number",
                  `double-number--${numberColor}`,
                  number === visualNumber && "double-number--current",
                  number === round.resultNumber && "double-number--result",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {number}
              </span>
            );
          })}
        </div>

        <pre className="json-view">
          {JSON.stringify(
            {
              status,
              selectedColor,
              visualNumber,
              frontendKnowsOutcome: round.resultNumber !== null,
              ...round,
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

function createEmptyRound() {
  return {
    externalRoundId: null,
    amount: 0,
    payout: 0,
    resultNumber: null,
    resultColor: null,
    won: null,
    payoutMultiplier: 0,
    seedCommitment: null,
    proof: null,
  };
}

/** Maps the backend number range to the colors used in the Double UI. */
function getDoubleColor(number) {
  if (number === 0) {
    return "green";
  }

  return number <= 7 ? "red" : "black";
}

/** Shows Double rounds persisted by the backend. */
function HistoryPanel({ history, onRefresh }) {
  return (
    <Card>
      <div className="history-heading-row">
        <h2 className="section-heading">Double API history</h2>
        <button type="button" className="button button--primary" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {history.length === 0 && <p className="muted-text">No records yet.</p>}

      {history.map((historyRound) => (
        <article key={historyRound.id} className="history-item">
          <strong
            className={`double-history-result--${historyRound.resultColor}`}
          >
            {historyRound.resultColor} {historyRound.resultNumber}
          </strong>
          <br />
          <span>
            selected: {historyRound.selectedColor} — {historyRound.won ? "won" : "lost"}
          </span>
          <br />
          <small>{historyRound.externalRoundId}</small>
        </article>
      ))}
    </Card>
  );
}

function isDoubleOrSystemLog(log) {
  return log.game === "double" || log.game === "system";
}
