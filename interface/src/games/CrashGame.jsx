import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const GAME_SERVER_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:4000";

const CHART_WIDTH = 900;
const CHART_HEIGHT = 420;
const CHART_PADDING = 36;

export default function CrashGame() {
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [apiStatus, setApiStatus] = useState("checking");

  const [phase, setPhase] = useState("initial");
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [roundId, setRoundId] = useState(null);
  const [multiplier, setMultiplier] = useState(1.0);
  const [crashPoint, setCrashPoint] = useState(null);

  const [serverSeedCommitment, setServerSeedCommitment] = useState(null);
  const [serverSeed, setServerSeed] = useState(null);
  const [publicSeed, setPublicSeed] = useState(null);

  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [gameServerLogs, setGameServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [chartPoints, setChartPoints] = useState([{ t: 0, y: 1.0 }]);

  useEffect(() => {
    checkApiHealth();
    fetchHistory();
    fetchApiLogs();

    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket", "polling"],
    });

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

    socket.on("server_logs_snapshot", (data) => {
      setGameServerLogs((data.logs || []).filter(isCrashOrSystem).slice(0, 12));
    });

    socket.on("game_server_log", (log) => {
      if (isCrashOrSystem(log)) {
        setGameServerLogs((oldLogs) => [log, ...oldLogs].slice(0, 12));
      }
    });

    socket.on("server_snapshot", (data) => {
      addEvent("server_snapshot", data);

      if (data.status === "active") {
        const snapshotMultiplier = Number(data.multiplier || 1);
        const elapsedSeconds = Number(data.elapsedSeconds || 0);

        setPhase("active");
        setRoundId(data.externalRoundId);
        setMultiplier(snapshotMultiplier);
        setCrashPoint(null);
        setServerSeed(null);
        setPublicSeed(null);
        setServerSeedCommitment(data.serverSeedCommitment || null);
        setChartPoints([
          { t: 0, y: 1.0 },
          { t: elapsedSeconds, y: snapshotMultiplier },
        ]);
      } else if (data.status) {
        setPhase(data.status);
        setSecondsLeft(data.secondsLeft || null);
      }
    });

    socket.on("round_waiting", (data) => {
      addEvent("round_waiting", data);

      setPhase("waiting");
      setSecondsLeft(data.secondsLeft);
      setRoundId(null);
      setMultiplier(1.0);
      setCrashPoint(null);
      setServerSeed(null);
      setPublicSeed(null);
      setServerSeedCommitment(null);
      setChartPoints([{ t: 0, y: 1.0 }]);
    });

    socket.on("round_started", (data) => {
      addEvent("round_started", data);

      setPhase("active");
      setSecondsLeft(null);
      setRoundId(data.externalRoundId);
      setMultiplier(1.0);
      setCrashPoint(null);
      setServerSeed(null);
      setPublicSeed(null);
      setServerSeedCommitment(data.serverSeedCommitment || null);
      setChartPoints([{ t: 0, y: 1.0 }]);
    });

    socket.on("multiplier_update", (data) => {
      const nextMultiplier = Number(data.multiplier || 1);
      const elapsedSeconds = Number(data.elapsedSeconds || 0);

      setMultiplier(nextMultiplier);

      setChartPoints((previous) => {
        const nextPoints = [
          ...previous,
          {
            t: elapsedSeconds,
            y: nextMultiplier,
          },
        ];

        return nextPoints.slice(-400);
      });
    });

    socket.on("round_crashed", async (data) => {
      addEvent("round_crashed", data);

      const finalCrashPoint = Number(data.crashPoint);

      setPhase("crashed");
      setCrashPoint(finalCrashPoint);
      setMultiplier(finalCrashPoint);

      setServerSeed(data.serverSeed || null);
      setPublicSeed(data.publicSeed || null);
      setServerSeedCommitment(data.serverSeedCommitment || null);

      setChartPoints((previous) => {
        const nextPoints = [
          ...previous,
          {
            t: Number(data.elapsedSeconds || previous.length * 0.1),
            y: finalCrashPoint,
          },
        ];

        return nextPoints.slice(-400);
      });

      await fetchHistory();
      await fetchApiLogs();
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  async function checkApiHealth() {
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

      if (data.success) {
        setHistory(data.rounds || []);
        setApiStatus("connected");
      } else {
        setApiStatus("error");
      }
    } catch {
      setHistory([]);
      setApiStatus("disconnected");
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logs?game=crash`);
      const data = await response.json();

      if (data.success) {
        setApiLogs(data.logs || []);
      }
    } catch {
      setApiLogs([]);
    }
  }

  function addEvent(name, payload) {
    setEvents((previousEvents) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString(),
        name,
        payload,
      },
      ...previousEvents,
    ].slice(0, 12));
  }

  const frontendKnowsCrashPoint = crashPoint !== null;

  const recentResults = useMemo(() => {
    return history.slice(0, 12);
  }, [history]);

  const maxMultiplierForChart = useMemo(() => {
    return Math.max(
      5,
      ...chartPoints.map((point) => point.y),
      multiplier,
      crashPoint || 1
    );
  }, [chartPoints, multiplier, crashPoint]);

  const maxTimeForChart = useMemo(() => {
    return Math.max(30, ...chartPoints.map((point) => point.t));
  }, [chartPoints]);

  const chartSvgPoints = useMemo(() => {
    if (chartPoints.length === 0) return "";

    return chartPoints
      .map((point) => {
        const x =
          CHART_PADDING +
          (point.t / maxTimeForChart) * (CHART_WIDTH - CHART_PADDING * 2);

        const yProgress = (point.y - 1) / (maxMultiplierForChart - 1);

        const y =
          CHART_HEIGHT -
          CHART_PADDING -
          yProgress * (CHART_HEIGHT - CHART_PADDING * 2);

        return `${x},${y}`;
      })
      .join(" ");
  }, [chartPoints, maxMultiplierForChart, maxTimeForChart]);

  const chartGuideLabels = useMemo(() => {
    return Array.from(new Set([1, 2, 3, 4, Math.ceil(maxMultiplierForChart)]))
      .filter((value) => value <= Math.ceil(maxMultiplierForChart));
  }, [maxMultiplierForChart]);

  const multiplierColor =
    phase === "crashed" ? "#f85149" : phase === "active" ? "#3fb950" : "#e6edf3";

  return (
    <div>
      <section style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Crash</h1>
            <p style={styles.subtitle}>
              Visual real-time representation of the crash round.
            </p>
          </div>

          <div style={styles.badgeRow}>
            <Badge label={`Socket: ${socketStatus}`} />
            <Badge label={`API: ${apiStatus}`} />
            <Badge label={`Phase: ${phase}`} />
            <Badge label={`Knows crash: ${frontendKnowsCrashPoint ? "yes" : "no"}`} />
          </div>
        </div>

        <div style={styles.recentStrip}>
          <span style={styles.recentStripLabel}>Recent results</span>

          {recentResults.length === 0 && (
            <span style={styles.emptyText}>No completed rounds yet.</span>
          )}

          {recentResults.map((round) => (
            <span
              key={round.id}
              style={{
                ...styles.resultPill,
                color: Number(round.crashPoint) >= 2 ? "#3fb950" : "#f85149",
              }}
            >
              {Number(round.crashPoint).toFixed(2)}x
            </span>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.chartContainer}>
          <div style={styles.chartHud}>
            {phase === "waiting" && (
              <div style={styles.waitingBox}>
                Next round starts in <strong>{secondsLeft}s</strong>
              </div>
            )}

            <div style={{ ...styles.multiplierDisplay, color: multiplierColor }}>
              {Number(multiplier).toFixed(2)}x
            </div>

            {phase === "active" && (
              <div style={styles.infoText}>
                Round is active. Frontend does not know the crash point.
              </div>
            )}

            {phase === "crashed" && (
              <div style={styles.crashedText}>
                Crashed at {Number(crashPoint).toFixed(2)}x
              </div>
            )}
          </div>

          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            style={styles.chartSvg}
          >
            <defs>
              <linearGradient id="lineGradient" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#2ea043" />
                <stop offset="100%" stopColor="#58a6ff" />
              </linearGradient>
            </defs>

            <rect
              x="0"
              y="0"
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              fill="#0d1117"
              rx="14"
            />

            {chartGuideLabels.map((label, index) => {
              const yProgress = (label - 1) / (maxMultiplierForChart - 1);

              const y =
                CHART_HEIGHT -
                CHART_PADDING -
                yProgress * (CHART_HEIGHT - CHART_PADDING * 2);

              return (
                <g key={`${label}-${index}`}>
                  <line
                    x1={CHART_PADDING}
                    x2={CHART_WIDTH - CHART_PADDING}
                    y1={y}
                    y2={y}
                    stroke="#30363d"
                    strokeDasharray="6 8"
                  />
                  <text x={10} y={y + 4} fill="#8b949e" fontSize="12">
                    {Number(label).toFixed(2)}x
                  </text>
                </g>
              );
            })}

            <line
              x1={CHART_PADDING}
              x2={CHART_PADDING}
              y1={CHART_PADDING}
              y2={CHART_HEIGHT - CHART_PADDING}
              stroke="#6e7681"
            />
            <line
              x1={CHART_PADDING}
              x2={CHART_WIDTH - CHART_PADDING}
              y1={CHART_HEIGHT - CHART_PADDING}
              y2={CHART_HEIGHT - CHART_PADDING}
              stroke="#6e7681"
            />

            {chartSvgPoints && (
              <polyline
                fill="none"
                stroke="url(#lineGradient)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={chartSvgPoints}
              />
            )}
          </svg>
        </div>
      </section>

      <section style={styles.card}>
        <h2>Current Round Data</h2>

        <pre style={styles.pre}>
{JSON.stringify(
  {
    phase,
    roundId,
    multiplier,
    crashPoint,
    frontendKnowsCrashPoint,
    serverSeedCommitment,
    serverSeed,
    publicSeed,
  },
  null,
  2
)}
        </pre>
      </section>

      <section style={styles.columns}>
        <LogPanel title="Socket Events" items={events} kind="event" />
        <HistoryPanel title="Crash API History" history={history} onRefresh={fetchHistory} />
        <LogPanel title="Game Server Logs" items={gameServerLogs} kind="server" />
        <LogPanel title="API Logs" items={apiLogs} kind="api" onRefresh={fetchApiLogs} />
      </section>
    </div>
  );
}

function isCrashOrSystem(log) {
  return log.game === "crash" || log.game === "system";
}

function Badge({ label }) {
  return <span style={styles.badge}>{label}</span>;
}

function HistoryPanel({ title, history, onRefresh }) {
  return (
    <div style={styles.card}>
      <h2>{title}</h2>

      <button style={styles.button} onClick={onRefresh}>
        Refresh
      </button>

      {history.length === 0 && <p>No completed rounds stored yet.</p>}

      {history.map((round) => (
        <div key={round.id} style={styles.historyItem}>
          <strong>{Number(round.crashPoint).toFixed(2)}x</strong>
          <br />
          <span>{round.externalRoundId}</span>
          <br />
          <small>{round.crashedAt}</small>
        </div>
      ))}
    </div>
  );
}

function LogPanel({ title, items, kind, onRefresh }) {
  return (
    <div style={styles.card}>
      <h2>{title}</h2>

      {onRefresh && (
        <button style={styles.button} onClick={onRefresh}>
          Refresh
        </button>
      )}

      {items.length === 0 && <p>No logs yet.</p>}

      {items.map((item) => (
        <div key={item.id} style={styles.event}>
          <strong>
            {item.time || new Date(item.createdAt).toLocaleTimeString()} —{" "}
            {item.name || item.event}
          </strong>

          <pre style={styles.smallPre}>
{JSON.stringify(kind === "event" ? item.payload : item.details, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

const styles = {
  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
  },
  title: {
    margin: 0,
    fontSize: 32,
  },
  subtitle: {
    margin: "8px 0 0 0",
    color: "#8b949e",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    background: "#0d1117",
    color: "#e6edf3",
    border: "1px solid #30363d",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 700,
  },
  recentStrip: {
    marginTop: 20,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  recentStripLabel: {
    color: "#8b949e",
    fontSize: 14,
    fontWeight: 700,
  },
  resultPill: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: 800,
  },
  emptyText: {
    color: "#8b949e",
  },
  chartContainer: {
    position: "relative",
  },
  chartHud: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none",
    textAlign: "center",
  },
  waitingBox: {
    position: "absolute",
    top: 18,
    background: "rgba(13,17,23,0.85)",
    border: "1px solid #30363d",
    borderRadius: 999,
    padding: "8px 14px",
    color: "#e6edf3",
  },
  multiplierDisplay: {
    fontSize: 88,
    fontWeight: 900,
    textShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  infoText: {
    marginTop: 10,
    color: "#3fb950",
    fontWeight: 700,
    background: "rgba(13,17,23,0.85)",
    padding: "8px 12px",
    borderRadius: 999,
  },
  crashedText: {
    marginTop: 10,
    color: "#f85149",
    fontWeight: 800,
    background: "rgba(13,17,23,0.9)",
    padding: "8px 12px",
    borderRadius: 999,
  },
  chartSvg: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: 14,
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
    fontSize: 12,
    overflowX: "auto",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
  },
  event: {
    borderTop: "1px solid #30363d",
    marginTop: 12,
    paddingTop: 12,
  },
  historyItem: {
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
    marginBottom: 8,
  },
};