import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const GAME_SERVER_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:4000";

const NUMBERS = Array.from({ length: 15 }, (_, index) => index);

export default function DoubleGame() {
  const socketRef = useRef(null);
  const spinIntervalRef = useRef(null);

  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");
  const [status, setStatus] = useState("idle");

  const [selectedColor, setSelectedColor] = useState("red");
  const [visualNumber, setVisualNumber] = useState(0);

  const [round, setRound] = useState({
    externalRoundId: null,
    resultNumber: null,
    resultColor: null,
    won: null,
    payoutMultiplier: 0,
    serverSeedCommitment: null,
    serverSeed: null,
    publicSeed: null,
  });

  const [message, setMessage] = useState(
    "Choose red, black, or green to start a round."
  );

  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [gameServerLogs, setGameServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);

  useEffect(() => {
    checkApi();
    fetchHistory();
    fetchApiLogs();

    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      addEvent("socket_connected", { socketId: socket.id });
    });

    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
      addEvent("socket_disconnected", {});
    });

    socket.on("connect_error", (error) => {
      setSocketStatus("connection error");
      addEvent("socket_connect_error", { message: error.message });
    });

    socket.on("server_logs_snapshot", (data) => {
      setGameServerLogs(
        (data.logs || [])
          .filter((log) => log.game === "double" || log.game === "system")
          .slice(0, 12)
      );
    });

    socket.on("game_server_log", (log) => {
      if (log.game === "double" || log.game === "system") {
        setGameServerLogs((oldLogs) => [log, ...oldLogs].slice(0, 12));
      }
    });

    socket.on("double_round_started", (data) => {
      addEvent("double_round_started", data);

      setStatus("spinning");
      setSelectedColor(data.selectedColor);

      setRound({
        externalRoundId: data.externalRoundId,
        resultNumber: null,
        resultColor: null,
        won: null,
        payoutMultiplier: 0,
        serverSeedCommitment: data.serverSeedCommitment,
        serverSeed: null,
        publicSeed: null,
      });

      setMessage(
        "The reel is spinning locally. The game server has not revealed the result yet."
      );

      startVisualSpin();
    });

    socket.on("double_round_finished", async (data) => {
      addEvent("double_round_finished", data);

      stopVisualSpin(data.resultNumber);

      setStatus("finished");
      setRound({
        externalRoundId: data.externalRoundId,
        resultNumber: Number(data.resultNumber),
        resultColor: data.resultColor,
        won: Boolean(data.won),
        payoutMultiplier: Number(data.payoutMultiplier || 0),
        serverSeedCommitment: data.serverSeedCommitment,
        serverSeed: data.serverSeed,
        publicSeed: data.publicSeed,
      });

      setMessage(
        data.won
          ? `You selected ${data.selectedColor} and won ${Number(
              data.payoutMultiplier
            ).toFixed(2)}x.`
          : `Result: ${data.resultColor} ${data.resultNumber}. You selected ${data.selectedColor}.`
      );

      await fetchHistory();
      await fetchApiLogs();
    });

    socket.on("double_error", (data) => {
      addEvent("double_error", data);
      setMessage(data.message || "Double game error.");
    });

    return () => {
      stopVisualSpin();
      socket.disconnect();
    };
  }, []);

  function startRound(color) {
    if (!socketRef.current || status === "spinning") return;

    setSelectedColor(color);
    socketRef.current.emit("double_start_round", {
      selectedColor: color,
    });
  }

  function startVisualSpin() {
    stopVisualSpin();

    let candidate = Math.floor(Math.random() * NUMBERS.length);
    setVisualNumber(candidate);

    spinIntervalRef.current = setInterval(() => {
      candidate = (candidate + 1 + Math.floor(Math.random() * 4)) % 15;
      setVisualNumber(candidate);
    }, 70);
  }

  function stopVisualSpin(finalNumber) {
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    if (Number.isInteger(Number(finalNumber))) {
      setVisualNumber(Number(finalNumber));
    }
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
      const response = await fetch(`${API_BASE_URL}/api/double/history`);
      const data = await response.json();

      if (data.success) {
        setHistory(data.rounds || []);
        setApiStatus("connected");
      }
    } catch {
      setHistory([]);
      setApiStatus("disconnected");
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logs?game=double`);
      const data = await response.json();

      if (data.success) {
        setApiLogs(data.logs || []);
      }
    } catch {
      setApiLogs([]);
    }
  }

  function addEvent(name, payload) {
    setEvents((oldEvents) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString(),
        name,
        payload,
      },
      ...oldEvents,
    ].slice(0, 12));
  }

  const visualColor = getColor(visualNumber);
  const frontendKnowsOutcome = round.resultNumber !== null;

  return (
    <div>
      <style>{`
        @keyframes doubleSpin {
          0% { transform: scale(0.88) rotate(-8deg); }
          50% { transform: scale(1.08) rotate(8deg); }
          100% { transform: scale(0.88) rotate(-8deg); }
        }
      `}</style>

      <section style={styles.card}>
        <h1>Double</h1>

        <p style={styles.subtitle}>
          The frontend runs a local animation. The computation server owns the
          secret result and only reveals it after the spin.
        </p>

        <div style={styles.statusGrid}>
          <Status label="Game Socket" value={socketStatus} />
          <Status label="API" value={apiStatus} />
          <Status label="Round Status" value={status} />
          <Status
            label="Knows Outcome?"
            value={frontendKnowsOutcome ? "yes" : "no"}
          />
        </div>
      </section>

      <section style={styles.card}>
        <h2>Choose a color</h2>

        <div style={styles.choices}>
          <ColorButton
            color="red"
            label="Red"
            payout="2.00x"
            selected={selectedColor === "red"}
            disabled={status === "spinning"}
            onClick={() => startRound("red")}
          />

          <ColorButton
            color="black"
            label="Black"
            payout="2.00x"
            selected={selectedColor === "black"}
            disabled={status === "spinning"}
            onClick={() => startRound("black")}
          />

          <ColorButton
            color="green"
            label="Green"
            payout="14.00x"
            selected={selectedColor === "green"}
            disabled={status === "spinning"}
            onClick={() => startRound("green")}
          />
        </div>

        <p style={styles.message}>{message}</p>
      </section>

      <section style={styles.card}>
        <h2>Number Reel</h2>

        <div style={styles.reel}>
          <div
            style={{
              ...styles.ball,
              background: colorHex(visualColor),
              animation:
                status === "spinning"
                  ? "doubleSpin 0.18s linear infinite"
                  : "none",
            }}
          >
            {visualNumber}
          </div>

          <strong>
            {status === "spinning"
              ? "Spinning locally — server result is hidden"
              : round.resultNumber === null
                ? "Choose a color to start"
                : `Server result: ${round.resultColor} ${round.resultNumber}`}
          </strong>
        </div>

        <div style={styles.numberRow}>
          {NUMBERS.map((number) => {
            const color = getColor(number);

            return (
              <span
                key={number}
                style={{
                  ...styles.numberChip,
                  background: colorHex(color),
                  ...(number === visualNumber ? styles.visualChip : {}),
                  ...(number === round.resultNumber ? styles.resultChip : {}),
                }}
              >
                {number}
              </span>
            );
          })}
        </div>

        <pre style={styles.pre}>
{JSON.stringify(
  {
    status,
    selectedColor,
    visualNumber,
    frontendKnowsOutcome,
    ...round,
  },
  null,
  2
)}
        </pre>
      </section>

      <section style={styles.columns}>
        <LogPanel title="Socket Events" items={events} eventMode />

        <section style={styles.card}>
          <h2>Double API History</h2>

          <button style={styles.button} onClick={fetchHistory}>
            Refresh
          </button>

          {history.length === 0 && <p>No completed rounds stored yet.</p>}

          {history.map((item) => (
            <div key={item.id} style={styles.logItem}>
              <strong style={{ color: colorHex(item.resultColor) }}>
                {item.resultColor} {item.resultNumber}
              </strong>
              <br />
              <span>
                selected: {item.selectedColor} —{" "}
                {item.won ? "won" : "lost"}
              </span>
              <br />
              <small>{item.externalRoundId}</small>
            </div>
          ))}
        </section>

        <LogPanel title="Game Server Logs" items={gameServerLogs} />
        <LogPanel
          title="API Logs"
          items={apiLogs}
          onRefresh={fetchApiLogs}
        />
      </section>
    </div>
  );
}

function getColor(number) {
  if (number === 0) return "green";
  return number <= 7 ? "red" : "black";
}

function colorHex(color) {
  if (color === "red") return "#da3633";
  if (color === "green") return "#238636";
  return "#21262d";
}

function ColorButton({ color, label, payout, selected, disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles.choiceButton,
        background: colorHex(color),
        ...(selected ? styles.selectedChoice : {}),
        ...(disabled ? styles.disabled : {}),
      }}
    >
      <strong>{label}</strong>
      <span>{payout}</span>
    </button>
  );
}

function Status({ label, value }) {
  const good = ["connected", "finished", "yes", "no"].includes(value);
  const bad = ["disconnected", "connection error", "error"].includes(value);

  return (
    <div style={styles.statusBox}>
      <span>{label}</span>
      <strong style={{ color: good ? "#3fb950" : bad ? "#f85149" : "#d29922" }}>
        {value}
      </strong>
    </div>
  );
}

function LogPanel({ title, items, eventMode = false, onRefresh }) {
  return (
    <section style={styles.card}>
      <h2>{title}</h2>

      {onRefresh && (
        <button style={styles.button} onClick={onRefresh}>
          Refresh
        </button>
      )}

      {items.length === 0 && <p>No logs yet.</p>}

      {items.map((item) => (
        <div key={item.id} style={styles.logItem}>
          <strong>
            {item.time || new Date(item.createdAt).toLocaleTimeString()} —{" "}
            {item.name || item.event}
          </strong>

          <pre style={styles.smallPre}>
{JSON.stringify(eventMode ? item.payload : item.details, null, 2)}
          </pre>
        </div>
      ))}
    </section>
  );
}

const styles = {
  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  subtitle: {
    color: "#8b949e",
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  statusBox: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  choices: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
  },
  choiceButton: {
    color: "white",
    minHeight: 86,
    border: "2px solid rgba(255,255,255,0.25)",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 18,
    fontWeight: 800,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 6,
  },
  selectedChoice: {
    boxShadow: "0 0 0 3px #58a6ff",
  },
  disabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  message: {
    marginTop: 16,
  },
  reel: {
    minHeight: 230,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 12,
  },
  ball: {
    width: 118,
    height: 118,
    borderRadius: "50%",
    color: "white",
    border: "5px solid rgba(255,255,255,0.3)",
    display: "grid",
    placeItems: "center",
    fontSize: 56,
    fontWeight: 900,
  },
  numberRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    margin: "20px 0",
  },
  numberChip: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.25)",
    color: "white",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },
  visualChip: {
    boxShadow: "0 0 0 3px #58a6ff",
    transform: "scale(1.1)",
  },
  resultChip: {
    boxShadow: "0 0 0 3px white",
  },
  pre: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 10,
    padding: 12,
    overflowX: "auto",
  },
  smallPre: {
    background: "#0d1117",
    borderRadius: 8,
    padding: 8,
    overflowX: "auto",
    fontSize: 12,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
  },
  logItem: {
    borderTop: "1px solid #30363d",
    marginTop: 12,
    paddingTop: 12,
    wordBreak: "break-all",
  },
  button: {
    background: "#238636",
    color: "white",
    border: 0,
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
};