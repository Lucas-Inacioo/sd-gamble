require("dotenv").config();

const crypto = require("crypto");
const http = require("http");
const cors = require("cors");
const express = require("express");
const { Server } = require("socket.io");

const {
  query,
  checkDatabase,
  addLog,
  saveCrashRound,
  saveMinesGame,
  saveDoubleRound,
} = require("./db");

const PORT = Number(process.env.PORT || 4000);
const WAITING_SECONDS = 5;
const COOLDOWN_MS = 3000;
const MULTIPLIER_UPDATE_MS = 100;
const CRASH_GROWTH_RATE = Number(process.env.CRASH_GROWTH_RATE || 0.06);
const MINES_BOARD_SIZE = 25;
const DOUBLE_SPIN_MS = 1400;

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
const httpServer = http.createServer(app);

function originIsAllowed(origin) {
  return !origin || allowedOrigins.includes(origin);
}

app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      if (originIsAllowed(origin)) return callback(null, true);
      return callback(new Error(`Origin blocked by CORS: ${origin}`));
    },
  })
);

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (originIsAllowed(origin)) return callback(null, true);
      return callback(new Error(`Origin blocked by Socket.IO CORS: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
});

let crashPhase = "booting";
let waitingSecondsLeft = null;
let currentCrashRound = null;
let serverLogs = [];

app.get("/health", async (_req, res) => {
  try {
    await checkDatabase();
    const payload = {
      ok: true,
      service: "distributed-casino-backend",
      role: "REST API + Socket.IO game engine",
      now: new Date().toISOString(),
    };
    safeApiLog("system", "health_check", payload);
    res.json(payload);
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "distributed-casino-backend",
      error: "Database unavailable",
    });
  }
});

app.get("/api/rounds/history", async (_req, res, next) => {
  try {
    const { rows } = await query(`
      select
        id,
        external_round_id as "externalRoundId",
        crash_point::float as "crashPoint",
        crashed_at as "crashedAt"
      from crash_rounds
      order by crashed_at desc
      limit 10
    `);
    safeApiLog("crash", "history_requested", { count: rows.length });
    res.json({ success: true, rounds: rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/mines/history", async (_req, res, next) => {
  try {
    const { rows } = await query(`
      select
        id,
        external_game_id as "externalGameId",
        status,
        mines_count as "minesCount",
        revealed_tiles as "revealedTiles",
        mine_positions as "minePositions",
        payout_multiplier::float as "payoutMultiplier",
        finished_at as "finishedAt"
      from mines_games
      order by finished_at desc
      limit 10
    `);
    safeApiLog("mines", "history_requested", { count: rows.length });
    res.json({ success: true, games: rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/double/history", async (_req, res, next) => {
  try {
    const { rows } = await query(`
      select
        id,
        external_round_id as "externalRoundId",
        selected_color as "selectedColor",
        result_number as "resultNumber",
        result_color as "resultColor",
        won,
        payout_multiplier::float as "payoutMultiplier",
        finished_at as "finishedAt"
      from double_rounds
      order by finished_at desc
      limit 10
    `);
    safeApiLog("double", "history_requested", { count: rows.length });
    res.json({ success: true, rounds: rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/logs", async (req, res, next) => {
  try {
    const game = req.query.game || null;
    const source = req.query.source || null;
    const { rows } = await query(
      `
        select
          id,
          source,
          game,
          event,
          details,
          created_at as "createdAt"
        from audit_logs
        where ($1::text is null or game = $1)
          and ($2::text is null or source = $2)
        order by created_at desc
        limit 100
      `,
      [game, source]
    );
    res.json({ success: true, logs: rows });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error("[api] request error", error);
  res.status(500).json({ success: false, message: "Internal server error." });
});

io.on("connection", (socket) => {
  logServer("system", "client_connected", { socketId: socket.id });
  socket.emit("server_snapshot", buildCrashSnapshot());
  socket.emit("server_logs_snapshot", { logs: serverLogs.slice(0, 80) });

  socket.on("disconnect", () => {
    logServer("system", "client_disconnected", { socketId: socket.id });
  });

  socket.on("mines_start_game", (payload = {}) => startMinesGame(socket, payload));
  socket.on("mines_reveal_tile", (payload = {}) => revealMinesTile(socket, payload));
  socket.on("mines_cash_out", () => cashOutMinesGame(socket));
  socket.on("double_start_round", (payload = {}) => startDoubleRound(socket, payload));
});

async function boot() {
  try {
    await checkDatabase();
  } catch (error) {
    console.error("Cannot start: database connection failed.", error.message);
    process.exit(1);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend listening on port ${PORT}`);
    console.log("Role: REST API, Socket.IO game engine and PostgreSQL persistence.");
    safeApiLog("system", "backend_started", { port: PORT });
    logServer("system", "game_engine_started", {
      port: PORT,
      role: "authoritative game computation",
    });
    startCrashLoop().catch((error) => {
      console.error("Crash loop stopped unexpectedly", error);
      process.exit(1);
    });
  });
}

async function startCrashLoop() {
  while (true) {
    await runCrashWaitingPhase();
    await runCrashActiveRound();
    await delay(COOLDOWN_MS);
  }
}

async function runCrashWaitingPhase() {
  crashPhase = "waiting";
  currentCrashRound = null;

  for (let secondsLeft = WAITING_SECONDS; secondsLeft >= 1; secondsLeft -= 1) {
    waitingSecondsLeft = secondsLeft;
    io.emit("round_waiting", { secondsLeft });
    if (secondsLeft === WAITING_SECONDS || secondsLeft === 1) {
      logServer("crash", "round_waiting", { secondsLeft });
    }
    await delay(1000);
  }
}

function runCrashActiveRound() {
  return new Promise((resolve) => {
    const secret = generateCrashSecret();
    crashPhase = "active";
    waitingSecondsLeft = null;

    currentCrashRound = {
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
      externalRoundId: currentCrashRound.externalRoundId,
      serverSeedCommitment: currentCrashRound.serverSeedCommitment,
      note: "Crash point remains secret until round_crashed.",
    });

    io.emit("round_started", {
      externalRoundId: currentCrashRound.externalRoundId,
      startedAt: new Date(currentCrashRound.startedAtMs).toISOString(),
      serverSeedCommitment: currentCrashRound.serverSeedCommitment,
    });

    const intervalId = setInterval(async () => {
      const round = currentCrashRound;
      if (!round || round.status !== "active") return;

      const elapsedSeconds = getElapsedSeconds(round.startedAtMs);
      const multiplier = getCrashMultiplier(round.startedAtMs);

      if (multiplier >= round.crashPoint) {
        clearInterval(intervalId);
        crashPhase = "crashed";
        round.status = "crashed";
        round.crashedAtMs = Date.now();

        const finalElapsedSeconds = getElapsedSeconds(round.startedAtMs);
        const finishedRound = { ...round };

        logServer("crash", "round_crashed", {
          externalRoundId: finishedRound.externalRoundId,
          crashPoint: finishedRound.crashPoint,
          elapsedSeconds: finalElapsedSeconds,
          note: "Crash point is revealed now.",
        });

        io.emit("round_crashed", {
          externalRoundId: finishedRound.externalRoundId,
          crashPoint: finishedRound.crashPoint,
          elapsedSeconds: finalElapsedSeconds,
          serverSeed: finishedRound.serverSeed,
          publicSeed: finishedRound.publicSeed,
          serverSeedCommitment: finishedRound.serverSeedCommitment,
        });

        await persistCrashRound(finishedRound);
        resolve();
        return;
      }

      io.emit("multiplier_update", {
        externalRoundId: round.externalRoundId,
        multiplier,
        elapsedSeconds,
      });
    }, MULTIPLIER_UPDATE_MS);
  });
}

function buildCrashSnapshot() {
  if (crashPhase === "active" && currentCrashRound) {
    return {
      status: "active",
      externalRoundId: currentCrashRound.externalRoundId,
      multiplier: getCrashMultiplier(currentCrashRound.startedAtMs),
      elapsedSeconds: getElapsedSeconds(currentCrashRound.startedAtMs),
      startedAt: new Date(currentCrashRound.startedAtMs).toISOString(),
      serverSeedCommitment: currentCrashRound.serverSeedCommitment,
    };
  }
  return { status: crashPhase, secondsLeft: waitingSecondsLeft };
}

function getElapsedSeconds(startedAtMs) {
  return Number(((Date.now() - startedAtMs) / 1000).toFixed(2));
}

function getCrashMultiplier(startedAtMs) {
  const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
  return Number(Math.exp(elapsedSeconds * CRASH_GROWTH_RATE).toFixed(2));
}

function generateCrashSecret() {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();
  const serverSeedCommitment = crypto.createHash("sha256").update(serverSeed).digest("hex");
  const hash = crypto.createHmac("sha256", serverSeed).update(publicSeed).digest("hex");
  return {
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    crashPoint: calculateCrashPoint(hash),
  };
}

function calculateCrashPoint(hash) {
  if (isHashDivisible(hash, 20)) return 1;
  const h = Number.parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  const result = Math.floor((100 * e - h) / (e - h)) / 100;
  return Math.max(1, Math.min(5, Number(result.toFixed(2))));
}

function isHashDivisible(hash, mod) {
  let value = 0;
  for (let index = 0; index < hash.length; index += 4) {
    value = ((value << 16) + Number.parseInt(hash.substring(index, index + 4), 16)) % mod;
  }
  return value === 0;
}

async function persistCrashRound(round) {
  try {
    logServer("crash", "database_persist_request", { externalRoundId: round.externalRoundId });
    await saveCrashRound(round);
    safeApiLog("crash", "round_persisted", {
      externalRoundId: round.externalRoundId,
      crashPoint: round.crashPoint,
    });
    logServer("crash", "database_persist_success", { externalRoundId: round.externalRoundId });
  } catch (error) {
    logServer("crash", "database_persist_failed", { message: error.message });
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
    payoutMultiplier: 1,
    serverSeed: secret.serverSeed,
    publicSeed: secret.publicSeed,
    serverSeedCommitment: secret.serverSeedCommitment,
  };
  socket.data.minesGame = game;

  logServer("mines", "game_started", {
    socketId: socket.id,
    externalGameId: game.externalGameId,
    minesCount,
    serverSeedCommitment: game.serverSeedCommitment,
    note: "Mine positions remain private until the game ends.",
  });

  socket.emit("mines_game_started", {
    externalGameId: game.externalGameId,
    minesCount,
    boardSize: MINES_BOARD_SIZE,
    revealedTiles: [],
    payoutMultiplier: 1,
    serverSeedCommitment: game.serverSeedCommitment,
    frontendKnowsMinePositions: false,
  });
}

function revealMinesTile(socket, payload) {
  const game = socket.data.minesGame;
  const tileIndex = Number(payload.tileIndex);

  if (!game || game.status !== "active") {
    rejectMines(socket, "No active Mines game. Start a new game first.", "no_active_game");
    return;
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= MINES_BOARD_SIZE) {
    rejectMines(socket, "Invalid tile index.", "invalid_tile");
    return;
  }
  if (game.revealedTiles.includes(tileIndex)) {
    rejectMines(socket, "Tile already revealed.", "already_revealed");
    return;
  }

  if (game.minePositions.includes(tileIndex)) {
    game.status = "lost";
    game.finishedAtMs = Date.now();
    game.payoutMultiplier = 0;
    logServer("mines", "mine_hit", {
      externalGameId: game.externalGameId,
      tileIndex,
      note: "Mine positions are now revealed because the game ended.",
    });
    socket.emit("mines_game_lost", publicFinishedMinesGame(game, { selectedTile: tileIndex }));
    persistMinesGame(game);
    return;
  }

  game.revealedTiles.push(tileIndex);
  game.revealedTiles.sort((a, b) => a - b);
  game.payoutMultiplier = calculateMinesPayout(game.minesCount, game.revealedTiles.length);

  if (game.revealedTiles.length === MINES_BOARD_SIZE - game.minesCount) {
    game.status = "won";
    game.finishedAtMs = Date.now();
    logServer("mines", "all_safe_tiles_revealed", {
      externalGameId: game.externalGameId,
      payoutMultiplier: game.payoutMultiplier,
    });
    socket.emit("mines_game_cashed_out", publicFinishedMinesGame(game));
    persistMinesGame(game);
    return;
  }

  logServer("mines", "safe_tile_revealed", {
    externalGameId: game.externalGameId,
    tileIndex,
    revealedCount: game.revealedTiles.length,
    payoutMultiplier: game.payoutMultiplier,
  });
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
    rejectMines(socket, "No active Mines game to cash out.", "no_active_game");
    return;
  }
  if (game.revealedTiles.length === 0) {
    rejectMines(socket, "Reveal at least one safe tile before cashing out.", "no_tiles_revealed");
    return;
  }

  game.status = "cashed_out";
  game.finishedAtMs = Date.now();
  logServer("mines", "game_cashed_out", {
    externalGameId: game.externalGameId,
    revealedCount: game.revealedTiles.length,
    payoutMultiplier: game.payoutMultiplier,
    note: "Mine positions are now revealed after cash out.",
  });
  socket.emit("mines_game_cashed_out", publicFinishedMinesGame(game));
  persistMinesGame(game);
}

function rejectMines(socket, message, reason) {
  logServer("mines", "action_rejected", { socketId: socket.id, reason });
  socket.emit("mines_error", { message });
}

function generateMinesSecret(minesCount) {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();
  const serverSeedCommitment = crypto.createHash("sha256").update(serverSeed).digest("hex");
  const mineSet = new Set();
  let nonce = 0;

  while (mineSet.size < minesCount) {
    const digest = crypto.createHmac("sha256", serverSeed).update(`${publicSeed}:${nonce}`).digest();
    for (let offset = 0; offset <= digest.length - 4 && mineSet.size < minesCount; offset += 4) {
      mineSet.add(digest.readUInt32BE(offset) % MINES_BOARD_SIZE);
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
  return Number((1 + revealedCount * (0.12 + risk * 0.75)).toFixed(2));
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

async function persistMinesGame(game) {
  try {
    logServer("mines", "database_persist_request", { externalGameId: game.externalGameId });
    await saveMinesGame(game);
    safeApiLog("mines", "game_persisted", {
      externalGameId: game.externalGameId,
      status: game.status,
    });
    logServer("mines", "database_persist_success", { externalGameId: game.externalGameId });
  } catch (error) {
    logServer("mines", "database_persist_failed", { message: error.message });
  }
}

function startDoubleRound(socket, payload) {
  const selectedColor = String(payload.selectedColor || "").toLowerCase();
  const validColors = ["red", "black", "green"];
  if (!validColors.includes(selectedColor)) {
    socket.emit("double_error", { message: "Choose red, black, or green." });
    logServer("double", "round_rejected", { socketId: socket.id, reason: "invalid_color" });
    return;
  }
  if (socket.data.doubleRound?.status === "spinning") {
    socket.emit("double_error", { message: "A Double round is already spinning." });
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
    note: "Outcome remains private until the spin ends.",
  });

  socket.emit("double_round_started", {
    externalRoundId: round.externalRoundId,
    selectedColor,
    spinDurationMs: DOUBLE_SPIN_MS,
    serverSeedCommitment: round.serverSeedCommitment,
    frontendKnowsOutcome: false,
  });

  setTimeout(async () => {
    if (socket.data.doubleRound !== round || round.status !== "spinning") return;
    round.status = "finished";
    round.finishedAtMs = Date.now();
    round.won = round.selectedColor === round.resultColor;
    round.payoutMultiplier = round.won ? getDoublePayout(round.selectedColor) : 0;

    logServer("double", "round_finished", {
      externalRoundId: round.externalRoundId,
      selectedColor: round.selectedColor,
      resultNumber: round.resultNumber,
      resultColor: round.resultColor,
      won: round.won,
      payoutMultiplier: round.payoutMultiplier,
    });

    socket.emit("double_round_finished", publicFinishedDoubleRound(round));
    await persistDoubleRound(round);
  }, DOUBLE_SPIN_MS);
}

function generateDoubleSecret() {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();
  const serverSeedCommitment = crypto.createHash("sha256").update(serverSeed).digest("hex");
  const hash = crypto.createHmac("sha256", serverSeed).update(publicSeed).digest("hex");
  const resultNumber = Number.parseInt(hash.slice(0, 8), 16) % 15;
  return { serverSeed, publicSeed, serverSeedCommitment, resultNumber, resultColor: getDoubleColor(resultNumber) };
}

function getDoubleColor(number) {
  if (number === 0) return "green";
  return number <= 7 ? "red" : "black";
}

function getDoublePayout(color) {
  return color === "green" ? 14 : 2;
}

function publicFinishedDoubleRound(round) {
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

async function persistDoubleRound(round) {
  try {
    logServer("double", "database_persist_request", { externalRoundId: round.externalRoundId });
    await saveDoubleRound(round);
    safeApiLog("double", "round_persisted", {
      externalRoundId: round.externalRoundId,
      resultNumber: round.resultNumber,
      resultColor: round.resultColor,
    });
    logServer("double", "database_persist_success", { externalRoundId: round.externalRoundId });
  } catch (error) {
    logServer("double", "database_persist_failed", { message: error.message });
  }
}

function logServer(game, event, details = {}) {
  const log = {
    id: crypto.randomUUID(),
    source: "game-server",
    game,
    event,
    details,
    createdAt: new Date().toISOString(),
  };
  console.log(`[game-server][${game}] ${event}`, details);
  serverLogs.unshift(log);
  serverLogs = serverLogs.slice(0, 250);
  io.emit("game_server_log", log);
  safeAudit("game-server", game, event, details);
  return log;
}

function safeApiLog(game, event, details = {}) {
  console.log(`[api][${game}] ${event}`, details);
  safeAudit("api", game, event, details);
}

function safeAudit(source, game, event, details) {
  addLog(source, game, event, details).catch((error) => {
    console.error("[audit] failed to persist log", error.message);
  });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

boot();
