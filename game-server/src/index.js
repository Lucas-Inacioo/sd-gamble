const crypto = require("crypto");
const { Server } = require("socket.io");
const fetch = require("node-fetch");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const GAME_SERVER_TOKEN = process.env.GAME_SERVER_TOKEN || "dev-secret-token";

const WAITING_SECONDS = 5;
const COOLDOWN_MS = 3000;
const MULTIPLIER_UPDATE_MS = 100;
const CRASH_GROWTH_RATE = 0.06;
const MINES_BOARD_SIZE = 25;
const DOUBLE_SPIN_MS = 1400;

const io = new Server(PORT, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

let crashPhase = "booting";
let waitingSecondsLeft = null;
let currentRound = null;
let serverLogs = [];

console.log(`Game server running on http://localhost:${PORT}`);
console.log("Role: computation + real-time coordination service");

logServer("system", "game_server_started", {
  port: PORT,
  role: "computation + real-time coordination",
});

io.on("connection", (socket) => {
  logServer("system", "client_connected", { socketId: socket.id });

  socket.emit("server_snapshot", buildCrashSnapshot());
  socket.emit("server_logs_snapshot", { logs: serverLogs.slice(0, 80) });

  socket.on("disconnect", () => {
    logServer("system", "client_disconnected", { socketId: socket.id });
  });

  socket.on("mines_start_game", (payload = {}) => {
    startMinesGame(socket, payload);
  });

  socket.on("mines_reveal_tile", (payload = {}) => {
    revealMinesTile(socket, payload);
  });

  socket.on("mines_cash_out", () => {
    cashOutMinesGame(socket);
  });

  socket.on("double_start_round", (payload = {}) => {
    startDoubleRound(socket, payload);
  });
});

startCrashLoop();

async function startCrashLoop() {
  while (true) {
    await runCrashWaitingPhase();
    await runCrashActiveRound();
    await delay(COOLDOWN_MS);
  }
}

async function runCrashWaitingPhase() {
  crashPhase = "waiting";

  for (let secondsLeft = WAITING_SECONDS; secondsLeft >= 1; secondsLeft--) {
    waitingSecondsLeft = secondsLeft;

    logServer("crash", "round_waiting", { secondsLeft });
    io.emit("round_waiting", { secondsLeft });

    await delay(1000);
  }
}

function runCrashActiveRound() {
  return new Promise((resolve) => {
    const secret = generateCrashSecret();

    crashPhase = "active";
    waitingSecondsLeft = null;

    currentRound = {
      status: "active",
      externalRoundId: crypto.randomUUID(),
      startedAtMs: Date.now(),
      crashedAtMs: null,
      crashPoint: secret.crashPoint,
      serverSeed: secret.serverSeed,
      publicSeed: secret.publicSeed,
      serverSeedCommitment: secret.serverSeedCommitment,
    };

    logServer("crash", "round_started", {
      externalRoundId: currentRound.externalRoundId,
      serverSeedCommitment: currentRound.serverSeedCommitment,
      note: "Crash point is hidden until round_crashed.",
    });

    io.emit("round_started", {
      externalRoundId: currentRound.externalRoundId,
      startedAt: new Date(currentRound.startedAtMs).toISOString(),
      serverSeedCommitment: currentRound.serverSeedCommitment,
    });

    const intervalId = setInterval(async () => {
      const elapsedSeconds = getElapsedSeconds(currentRound.startedAtMs);
      const multiplier = getCrashMultiplier(currentRound.startedAtMs);

      if (multiplier >= currentRound.crashPoint) {
        clearInterval(intervalId);

        crashPhase = "crashed";
        currentRound.status = "crashed";
        currentRound.crashedAtMs = Date.now();

        const finishedRound = { ...currentRound };
        const finalElapsedSeconds = getElapsedSeconds(finishedRound.startedAtMs);

        logServer("crash", "round_crashed", {
          externalRoundId: finishedRound.externalRoundId,
          crashPoint: finishedRound.crashPoint,
          elapsedSeconds: finalElapsedSeconds,
          note: "Crash point is revealed only now.",
        });

        io.emit("round_crashed", {
          externalRoundId: finishedRound.externalRoundId,
          crashPoint: finishedRound.crashPoint,
          elapsedSeconds: finalElapsedSeconds,
          serverSeed: finishedRound.serverSeed,
          publicSeed: finishedRound.publicSeed,
          serverSeedCommitment: finishedRound.serverSeedCommitment,
        });

        await saveCrashRoundToApi(finishedRound);

        resolve();
        return;
      }

      io.emit("multiplier_update", {
        externalRoundId: currentRound.externalRoundId,
        multiplier,
        elapsedSeconds,
      });
    }, MULTIPLIER_UPDATE_MS);
  });
}

function buildCrashSnapshot() {
  if (crashPhase === "active" && currentRound) {
    const elapsedSeconds = getElapsedSeconds(currentRound.startedAtMs);

    return {
      status: "active",
      externalRoundId: currentRound.externalRoundId,
      multiplier: getCrashMultiplier(currentRound.startedAtMs),
      elapsedSeconds,
      serverSeedCommitment: currentRound.serverSeedCommitment,
    };
  }

  return {
    status: crashPhase,
    secondsLeft: waitingSecondsLeft,
  };
}

function getElapsedSeconds(startedAtMs) {
  return Number(((Date.now() - startedAtMs) / 1000).toFixed(2));
}

function getCrashMultiplier(startedAtMs) {
  const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
  const multiplier = Math.exp(elapsedSeconds * CRASH_GROWTH_RATE);

  return Number(multiplier.toFixed(2));
}

function generateCrashSecret() {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();

  const serverSeedCommitment = crypto
    .createHash("sha256")
    .update(serverSeed)
    .digest("hex");

  const hash = crypto
    .createHmac("sha256", serverSeed)
    .update(publicSeed)
    .digest("hex");

  return {
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    crashPoint: calculateCrashPoint(hash),
  };
}

function calculateCrashPoint(hash) {
  if (isHashDivisible(hash, 20)) return 1.0;

  const h = Number.parseInt(hash.slice(0, 13), 16);
  const e = Math.pow(2, 52);
  const result = Math.floor((100 * e - h) / (e - h)) / 100;

  return Math.max(1.0, Math.min(5.0, Number(result.toFixed(2))));
}

function isHashDivisible(hash, mod) {
  let value = 0;

  for (let i = 0; i < hash.length; i += 4) {
    value =
      ((value << 16) + Number.parseInt(hash.substring(i, i + 4), 16)) % mod;
  }

  return value === 0;
}

async function saveCrashRoundToApi(round) {
  try {
    logServer("crash", "api_persist_request", {
      externalRoundId: round.externalRoundId,
    });

    const response = await fetch(`${API_BASE_URL}/api/internal/rounds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Game-Server-Token": GAME_SERVER_TOKEN,
      },
      body: JSON.stringify({
        externalRoundId: round.externalRoundId,
        crashPoint: round.crashPoint,
        serverSeed: round.serverSeed,
        publicSeed: round.publicSeed,
        serverSeedCommitment: round.serverSeedCommitment,
        startedAt: new Date(round.startedAtMs).toISOString(),
        crashedAt: new Date(round.crashedAtMs).toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();

      logServer("crash", "api_persist_failed", {
        status: response.status,
        body: text,
      });

      return;
    }

    logServer("crash", "api_persist_success", {
      externalRoundId: round.externalRoundId,
    });
  } catch (error) {
    logServer("crash", "api_persist_error", {
      message: error.message,
    });
  }
}

function startMinesGame(socket, payload) {
  const minesCount = clamp(Number(payload.minesCount || 3), 1, MINES_BOARD_SIZE - 1);
  const secret = generateMinesSecret(minesCount);

  const game = {
    status: "active",
    externalGameId: crypto.randomUUID(),
    startedAtMs: Date.now(),
    finishedAtMs: null,
    minesCount,
    minePositions: secret.minePositions,
    revealedTiles: [],
    payoutMultiplier: 1.0,
    serverSeed: secret.serverSeed,
    publicSeed: secret.publicSeed,
    serverSeedCommitment: secret.serverSeedCommitment,
  };

  socket.data.minesGame = game;

  logServer("mines", "game_started", {
    socketId: socket.id,
    externalGameId: game.externalGameId,
    minesCount: game.minesCount,
    serverSeedCommitment: game.serverSeedCommitment,
    note: "Mine positions are hidden until loss or cash out.",
  });

  socket.emit("mines_game_started", {
    externalGameId: game.externalGameId,
    minesCount: game.minesCount,
    boardSize: MINES_BOARD_SIZE,
    revealedTiles: [],
    payoutMultiplier: game.payoutMultiplier,
    serverSeedCommitment: game.serverSeedCommitment,
  });
}

function revealMinesTile(socket, payload) {
  const game = socket.data.minesGame;
  const tileIndex = Number(payload.tileIndex);

  if (!game || game.status !== "active") {
    socket.emit("mines_error", {
      message: "No active mines game. Start a new game first.",
    });

    logServer("mines", "reveal_rejected", {
      socketId: socket.id,
      reason: "no_active_game",
    });

    return;
  }

  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= MINES_BOARD_SIZE) {
    socket.emit("mines_error", { message: "Invalid tile index." });

    logServer("mines", "reveal_rejected", {
      externalGameId: game.externalGameId,
      reason: "invalid_tile",
      tileIndex,
    });

    return;
  }

  if (game.revealedTiles.includes(tileIndex)) {
    socket.emit("mines_error", { message: "Tile already revealed." });

    logServer("mines", "reveal_rejected", {
      externalGameId: game.externalGameId,
      reason: "already_revealed",
      tileIndex,
    });

    return;
  }

  if (game.minePositions.includes(tileIndex)) {
    game.status = "lost";
    game.finishedAtMs = Date.now();
    game.payoutMultiplier = 0;

    logServer("mines", "mine_hit", {
      externalGameId: game.externalGameId,
      tileIndex,
      minePositions: game.minePositions,
      note: "Mine positions are revealed because the game ended.",
    });

    socket.emit("mines_game_lost", publicFinishedMinesGame(game, {
      selectedTile: tileIndex,
    }));

    saveMinesGameToApi(game);
    return;
  }

  game.revealedTiles.push(tileIndex);
  game.revealedTiles.sort((a, b) => a - b);
  game.payoutMultiplier = calculateMinesPayout(game.minesCount, game.revealedTiles.length);

  logServer("mines", "safe_tile_revealed", {
    externalGameId: game.externalGameId,
    tileIndex,
    revealedCount: game.revealedTiles.length,
    payoutMultiplier: game.payoutMultiplier,
    note: "Mine positions remain hidden.",
  });

  const allSafeTilesRevealed =
    game.revealedTiles.length === MINES_BOARD_SIZE - game.minesCount;

  if (allSafeTilesRevealed) {
    game.status = "won";
    game.finishedAtMs = Date.now();

    logServer("mines", "all_safe_tiles_revealed", {
      externalGameId: game.externalGameId,
      payoutMultiplier: game.payoutMultiplier,
    });

    socket.emit("mines_game_cashed_out", publicFinishedMinesGame(game));
    saveMinesGameToApi(game);
    return;
  }

  socket.emit("mines_tile_revealed", {
    externalGameId: game.externalGameId,
    tileIndex,
    revealedTiles: game.revealedTiles,
    payoutMultiplier: game.payoutMultiplier,
    frontendKnowsMinePositions: false,
  });
}

function cashOutMinesGame(socket) {
  const game = socket.data.minesGame;

  if (!game || game.status !== "active") {
    socket.emit("mines_error", {
      message: "No active mines game to cash out.",
    });

    logServer("mines", "cashout_rejected", {
      socketId: socket.id,
      reason: "no_active_game",
    });

    return;
  }

  if (game.revealedTiles.length === 0) {
    socket.emit("mines_error", {
      message: "Reveal at least one safe tile before cashing out.",
    });

    logServer("mines", "cashout_rejected", {
      externalGameId: game.externalGameId,
      reason: "no_tiles_revealed",
    });

    return;
  }

  game.status = "cashed_out";
  game.finishedAtMs = Date.now();

  logServer("mines", "game_cashed_out", {
    externalGameId: game.externalGameId,
    revealedTiles: game.revealedTiles.length,
    payoutMultiplier: game.payoutMultiplier,
    note: "Mine positions are revealed after cash out.",
  });

  socket.emit("mines_game_cashed_out", publicFinishedMinesGame(game));
  saveMinesGameToApi(game);
}

function publicFinishedMinesGame(game, extra = {}) {
  return {
    externalGameId: game.externalGameId,
    status: game.status,
    minesCount: game.minesCount,
    revealedTiles: game.revealedTiles,
    minePositions: game.minePositions,
    payoutMultiplier: game.payoutMultiplier,
    serverSeed: game.serverSeed,
    publicSeed: game.publicSeed,
    serverSeedCommitment: game.serverSeedCommitment,
    frontendKnowsMinePositions: true,
    ...extra,
  };
}

function generateMinesSecret(minesCount) {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();

  const serverSeedCommitment = crypto
    .createHash("sha256")
    .update(serverSeed)
    .digest("hex");

  const mineSet = new Set();
  let nonce = 0;

  while (mineSet.size < minesCount) {
    const digest = crypto
      .createHmac("sha256", serverSeed)
      .update(`${publicSeed}:${nonce}`)
      .digest();

    for (
      let offset = 0;
      offset <= digest.length - 4 && mineSet.size < minesCount;
      offset += 4
    ) {
      const value = digest.readUInt32BE(offset);
      mineSet.add(value % MINES_BOARD_SIZE);
    }

    nonce += 1;
  }

  return {
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    minePositions: Array.from(mineSet).sort((a, b) => a - b),
  };
}

function calculateMinesPayout(minesCount, revealedCount) {
  const risk = minesCount / MINES_BOARD_SIZE;
  const multiplier = 1 + revealedCount * (0.12 + risk * 0.75);

  return Number(multiplier.toFixed(2));
}

async function saveMinesGameToApi(game) {
  try {
    logServer("mines", "api_persist_request", {
      externalGameId: game.externalGameId,
      status: game.status,
    });

    const response = await fetch(`${API_BASE_URL}/api/internal/mines/games`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Game-Server-Token": GAME_SERVER_TOKEN,
      },
      body: JSON.stringify({
        externalGameId: game.externalGameId,
        status: game.status,
        minesCount: game.minesCount,
        revealedTiles: game.revealedTiles,
        minePositions: game.minePositions,
        payoutMultiplier: game.payoutMultiplier,
        serverSeed: game.serverSeed,
        publicSeed: game.publicSeed,
        serverSeedCommitment: game.serverSeedCommitment,
        startedAt: new Date(game.startedAtMs).toISOString(),
        finishedAt: new Date(game.finishedAtMs).toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();

      logServer("mines", "api_persist_failed", {
        status: response.status,
        body: text,
      });

      return;
    }

    logServer("mines", "api_persist_success", {
      externalGameId: game.externalGameId,
    });
  } catch (error) {
    logServer("mines", "api_persist_error", {
      message: error.message,
    });
  }
}

function startDoubleRound(socket, payload) {
  const selectedColor = String(payload.selectedColor || "").toLowerCase();
  const validColors = ["red", "black", "green"];

  if (!validColors.includes(selectedColor)) {
    socket.emit("double_error", {
      message: "Choose red, black, or green.",
    });

    logServer("double", "round_rejected", {
      socketId: socket.id,
      reason: "invalid_color",
      selectedColor,
    });

    return;
  }

  if (socket.data.doubleRound?.status === "spinning") {
    socket.emit("double_error", {
      message: "A Double round is already spinning.",
    });

    logServer("double", "round_rejected", {
      socketId: socket.id,
      reason: "already_spinning",
    });

    return;
  }

  const secret = generateDoubleSecret();

  const round = {
    status: "spinning",
    externalRoundId: crypto.randomUUID(),
    selectedColor,
    resultNumber: secret.resultNumber,
    resultColor: secret.resultColor,
    won: null,
    payoutMultiplier: 0,
    startedAtMs: Date.now(),
    finishedAtMs: null,
    serverSeed: secret.serverSeed,
    publicSeed: secret.publicSeed,
    serverSeedCommitment: secret.serverSeedCommitment,
  };

  socket.data.doubleRound = round;

  logServer("double", "round_started", {
    socketId: socket.id,
    externalRoundId: round.externalRoundId,
    selectedColor,
    serverSeedCommitment: round.serverSeedCommitment,
    spinDurationMs: DOUBLE_SPIN_MS,
    note: "Result stays private in the game server until the spin finishes.",
  });

  socket.emit("double_round_started", {
    externalRoundId: round.externalRoundId,
    selectedColor,
    spinDurationMs: DOUBLE_SPIN_MS,
    serverSeedCommitment: round.serverSeedCommitment,
    frontendKnowsOutcome: false,
  });

  setTimeout(async () => {
    if (socket.data.doubleRound !== round || round.status !== "spinning") {
      return;
    }

    round.status = "finished";
    round.finishedAtMs = Date.now();
    round.won = round.selectedColor === round.resultColor;
    round.payoutMultiplier = round.won
      ? getDoublePayout(round.selectedColor)
      : 0;

    logServer("double", "round_finished", {
      externalRoundId: round.externalRoundId,
      selectedColor: round.selectedColor,
      resultNumber: round.resultNumber,
      resultColor: round.resultColor,
      won: round.won,
      payoutMultiplier: round.payoutMultiplier,
      note: "Result revealed after server-side round completion.",
    });

    socket.emit("double_round_finished", publicDoubleRound(round));

    await saveDoubleRoundToApi(round);
  }, DOUBLE_SPIN_MS);
}

function generateDoubleSecret() {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();

  const serverSeedCommitment = crypto
    .createHash("sha256")
    .update(serverSeed)
    .digest("hex");

  const hash = crypto
    .createHmac("sha256", serverSeed)
    .update(publicSeed)
    .digest("hex");

  // 0 green, 1-7 red, 8-14 black.
  const resultNumber = Number.parseInt(hash.slice(0, 8), 16) % 15;

  return {
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    resultNumber,
    resultColor: getDoubleColor(resultNumber),
  };
}

function getDoubleColor(number) {
  if (number === 0) return "green";
  return number <= 7 ? "red" : "black";
}

function getDoublePayout(color) {
  return color === "green" ? 14 : 2;
}

function publicDoubleRound(round) {
  return {
    externalRoundId: round.externalRoundId,
    selectedColor: round.selectedColor,
    resultNumber: round.resultNumber,
    resultColor: round.resultColor,
    won: round.won,
    payoutMultiplier: round.payoutMultiplier,
    serverSeed: round.serverSeed,
    publicSeed: round.publicSeed,
    serverSeedCommitment: round.serverSeedCommitment,
    frontendKnowsOutcome: true,
  };
}

async function saveDoubleRoundToApi(round) {
  try {
    logServer("double", "api_persist_request", {
      externalRoundId: round.externalRoundId,
    });

    const response = await fetch(`${API_BASE_URL}/api/internal/double/rounds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Game-Server-Token": GAME_SERVER_TOKEN,
      },
      body: JSON.stringify({
        externalRoundId: round.externalRoundId,
        selectedColor: round.selectedColor,
        resultNumber: round.resultNumber,
        resultColor: round.resultColor,
        won: round.won,
        payoutMultiplier: round.payoutMultiplier,
        serverSeed: round.serverSeed,
        publicSeed: round.publicSeed,
        serverSeedCommitment: round.serverSeedCommitment,
        startedAt: new Date(round.startedAtMs).toISOString(),
        finishedAt: new Date(round.finishedAtMs).toISOString(),
      }),
    });

    if (!response.ok) {
      logServer("double", "api_persist_failed", {
        externalRoundId: round.externalRoundId,
        status: response.status,
      });

      return;
    }

    logServer("double", "api_persist_success", {
      externalRoundId: round.externalRoundId,
    });
  } catch (error) {
    logServer("double", "api_persist_error", {
      message: error.message,
    });
  }
}

function logServer(game, event, details = {}) {
  const log = {
    id: `${Date.now()}-${Math.random()}`,
    service: "game-server",
    game,
    event,
    details,
    createdAt: new Date().toISOString(),
  };

  console.log(`[game-server][${game}] ${event}`, details);

  serverLogs.unshift(log);
  serverLogs = serverLogs.slice(0, 250);

  io.emit("game_server_log", log);

  return log;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}