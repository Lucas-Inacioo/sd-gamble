import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, GAME_SERVER_URL } from "../config.js";
import { Card, DebugPanel, StatusBox } from "../components/DebugPanels.jsx";

const BOARD_SIZE = 25;
const MINE_OPTIONS = [1, 2, 3, 5, 7, 10];

/**
 * Mines game screen.
 *
 * The browser reveals only the tiles returned by the backend. Mine positions
 * remain server-side until the game finishes, which demonstrates a server-
 * authoritative interaction model.
 */
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
  const [message, setMessage] = useState(
    "Choose the number of mines and start a game."
  );

  const [events, setEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [history, setHistory] = useState([]);

  /** Connects the page to the game engine and subscribes to Mines events. */
  useEffect(() => {
    loadApiData();

    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket", "polling"],
    });
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
      setServerLogs(logs.filter(isMinesOrSystemLog).slice(0, 12));
    });

    socket.on("game_server_log", (log) => {
      if (isMinesOrSystemLog(log)) {
        setServerLogs((previousLogs) => [log, ...previousLogs].slice(0, 12));
      }
    });

    socket.on("mines_game_started", (data) => {
      addEvent("mines_game_started", data);
      setStatus("active");
      setGameId(data.externalGameId);
      setRevealedTiles([]);
      setMinePositions(null);
      setPayoutMultiplier(1);
      setSeedCommitment(data.serverSeedCommitment);
      setProof(null);
      setMessage("Game active. Mine positions are hidden on the game server.");
    });

    socket.on("mines_tile_revealed", (data) => {
      addEvent("mines_tile_revealed", data);
      setRevealedTiles(data.revealedTiles || []);
      setPayoutMultiplier(Number(data.payoutMultiplier || 1));
      setMessage("Safe tile revealed. Mine positions remain hidden.");
    });

    socket.on("mines_game_lost", async (data) => {
      addEvent("mines_game_lost", data);
      setStatus("lost");
      setRevealedTiles(data.revealedTiles || []);
      setMinePositions(data.minePositions || []);
      setPayoutMultiplier(0);
      setProof({
        serverSeed: data.serverSeed,
        publicSeed: data.publicSeed,
      });
      setMessage("A mine was found. The server revealed the full board.");
      await loadApiData();
    });

    socket.on("mines_game_cashed_out", async (data) => {
      addEvent("mines_game_cashed_out", data);
      setStatus(data.status || "cashed_out");
      setRevealedTiles(data.revealedTiles || []);
      setMinePositions(data.minePositions || []);
      setPayoutMultiplier(Number(data.payoutMultiplier || 0));
      setProof({
        serverSeed: data.serverSeed,
        publicSeed: data.publicSeed,
      });
      setMessage(
        `Game finished at ${Number(data.payoutMultiplier || 0).toFixed(2)}x. The server revealed the board.`
      );
      await loadApiData();
    });

    socket.on("mines_error", (data) => {
      addEvent("mines_error", data);
      setMessage(data.message || "Mines error.");
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, []);

  /** Asks the server to create a fresh, private Mines board. */
  function startGame() {
    if (socketRef.current && status !== "active") {
      socketRef.current.emit("mines_start_game", { minesCount });
    }
  }

  /** Requests a tile reveal. The server decides whether it contains a mine. */
  function revealTile(tileIndex) {
    if (status === "active" && !revealedTiles.includes(tileIndex)) {
      socketRef.current?.emit("mines_reveal_tile", { tileIndex });
    }
  }

  /** Ends the current game using the payout multiplier determined by the server. */
  function cashOut() {
    if (status === "active") {
      socketRef.current?.emit("mines_cash_out");
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
      const response = await fetch(`${API_BASE_URL}/api/mines/history`);
      const data = await response.json();
      setHistory(data.games || []);
    } catch {
      setHistory([]);
    }
  }

  async function fetchApiLogs() {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/logs?game=mines&source=api`
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

  return (
    <div>
      <Card>
        <h1 className="game-title">Mines</h1>

        <div className="status-grid">
          <StatusBox label="Game socket" value={socketStatus} />
          <StatusBox label="API" value={apiStatus} />
          <StatusBox label="Game status" value={status} />
          <StatusBox
            label="Knows mine positions?"
            value={minePositions ? "yes" : "no"}
          />
        </div>
      </Card>

      <Card>
        <div className="mines-controls">
          <label className="mines-select-label">
            Mine count
            <select
              className="form-control"
              value={minesCount}
              disabled={status === "active"}
              onChange={(event) => setMinesCount(Number(event.target.value))}
            >
              {MINE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="button button--primary"
            disabled={status === "active"}
            onClick={startGame}
          >
            Start Mines
          </button>

          <button
            type="button"
            className="button button--accent"
            disabled={status !== "active" || revealedTiles.length === 0}
            onClick={cashOut}
          >
            Cash out ({payoutMultiplier.toFixed(2)}x)
          </button>
        </div>

        <p className="message-box" aria-live="polite">
          {message}
        </p>

        <div className="mines-board" aria-label="Mines board">
          {Array.from({ length: BOARD_SIZE }, (_, tileIndex) => {
            const isRevealed = revealedTiles.includes(tileIndex);
            const isMine = minePositions?.includes(tileIndex);
            const className = [
              "mines-tile",
              isRevealed && "mines-tile--safe",
              isMine && "mines-tile--mine",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={tileIndex}
                type="button"
                className={className}
                disabled={status !== "active" || isRevealed}
                aria-label={
                  isMine
                    ? `Tile ${tileIndex + 1}: mine`
                    : isRevealed
                      ? `Tile ${tileIndex + 1}: safe`
                      : `Reveal tile ${tileIndex + 1}`
                }
                onClick={() => revealTile(tileIndex)}
              >
                {isMine ? "✹" : isRevealed ? "✓" : "?"}
              </button>
            );
          })}
        </div>

        <pre className="json-view">
          {JSON.stringify(
            {
              status,
              gameId,
              minesCount,
              revealedTiles,
              minePositions,
              payoutMultiplier,
              seedCommitment,
              proof,
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

/** Shows persisted Mines games returned by the REST API. */
function HistoryPanel({ history, onRefresh }) {
  return (
    <Card>
      <div className="history-heading-row">
        <h2 className="section-heading">Mines API history</h2>
        <button type="button" className="button button--primary" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {history.length === 0 && <p className="muted-text">No records yet.</p>}

      {history.map((game) => (
        <article key={game.id} className="history-item">
          <strong>{game.status}</strong>
          <br />
          <span>
            {game.minesCount} mines — {Number(game.payoutMultiplier).toFixed(2)}x
          </span>
          <br />
          <small>{game.externalGameId}</small>
        </article>
      ))}
    </Card>
  );
}

function isMinesOrSystemLog(log) {
  return log.game === "mines" || log.game === "system";
}
