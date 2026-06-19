const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = Number(process.env.PORT || 4000);
const GAME_SERVER_TOKEN = process.env.GAME_SERVER_TOKEN || "dev-secret-token";

const app = express();
app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, "..", "data");
const roundsFile = path.join(dataDir, "rounds.json");
const minesGamesFile = path.join(dataDir, "mines-games.json");
const apiLogsFile = path.join(dataDir, "api-logs.json");

ensureDataFiles();

app.get("/health", (req, res) => {
  const payload = {
    ok: true,
    service: "api",
    role: "data/persistence",
    now: new Date().toISOString(),
  };

  logApi("system", "health_check", payload);
  res.json(payload);
});

app.get("/api/logs", (req, res) => {
  const game = req.query.game;
  const logs = readJson(apiLogsFile)
    .filter((log) => !game || log.game === game || log.game === "system")
    .slice(0, 80);

  res.json({ success: true, logs });
});

app.post("/api/internal/rounds", requireGameServerToken, (req, res) => {
  const {
    externalRoundId,
    crashPoint,
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    startedAt,
    crashedAt,
  } = req.body;

  if (!externalRoundId || !crashPoint || !serverSeed || !publicSeed || !serverSeedCommitment || !startedAt || !crashedAt) {
    logApi("crash", "store_round_rejected", { reason: "missing_required_fields", body: req.body });
    return res.status(422).json({ success: false, message: "Missing required crash round fields." });
  }

  const rounds = readJson(roundsFile);

  if (rounds.some((round) => round.externalRoundId === externalRoundId)) {
    logApi("crash", "store_round_duplicate", { externalRoundId });
    return res.status(409).json({ success: false, message: "Round already exists." });
  }

  const round = {
    id: rounds.length + 1,
    externalRoundId,
    crashPoint: Number(crashPoint),
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    startedAt,
    crashedAt,
    createdAt: new Date().toISOString(),
  };

  rounds.unshift(round);
  writeJson(roundsFile, rounds.slice(0, 100));

  logApi("crash", "round_persisted", {
    externalRoundId,
    crashPoint: Number(crashPoint),
    recordsStored: rounds.length,
  });

  res.status(201).json({ success: true, round });
});

app.get("/api/rounds/history", (req, res) => {
  const rounds = readJson(roundsFile).slice(0, 10);
  logApi("crash", "history_requested", { count: rounds.length });
  res.json({ success: true, rounds });
});

app.post("/api/internal/mines/games", requireGameServerToken, (req, res) => {
  const {
    externalGameId,
    status,
    minesCount,
    revealedTiles,
    minePositions,
    payoutMultiplier,
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    startedAt,
    finishedAt,
  } = req.body;

  if (!externalGameId || !status || !minesCount || !Array.isArray(revealedTiles) || !Array.isArray(minePositions) || !serverSeed || !publicSeed || !serverSeedCommitment || !startedAt || !finishedAt) {
    logApi("mines", "store_game_rejected", { reason: "missing_required_fields", body: req.body });
    return res.status(422).json({ success: false, message: "Missing required mines game fields." });
  }

  const games = readJson(minesGamesFile);

  if (games.some((game) => game.externalGameId === externalGameId)) {
    logApi("mines", "store_game_duplicate", { externalGameId });
    return res.status(409).json({ success: false, message: "Mines game already exists." });
  }

  const game = {
    id: games.length + 1,
    externalGameId,
    status,
    minesCount: Number(minesCount),
    revealedTiles,
    minePositions,
    payoutMultiplier: Number(payoutMultiplier || 0),
    serverSeed,
    publicSeed,
    serverSeedCommitment,
    startedAt,
    finishedAt,
    createdAt: new Date().toISOString(),
  };

  games.unshift(game);
  writeJson(minesGamesFile, games.slice(0, 100));

  logApi("mines", "game_persisted", {
    externalGameId,
    status,
    minesCount: Number(minesCount),
    revealedTiles: revealedTiles.length,
    payoutMultiplier: Number(payoutMultiplier || 0),
    recordsStored: games.length,
  });

  res.status(201).json({ success: true, game });
});

app.get("/api/mines/history", (req, res) => {
  const games = readJson(minesGamesFile).slice(0, 10);
  logApi("mines", "history_requested", { count: games.length });
  res.json({ success: true, games });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log("Role: data/persistence service");
  logApi("system", "api_started", { port: PORT, role: "data/persistence service" });
});

function requireGameServerToken(req, res, next) {
  const receivedToken = req.header("X-Game-Server-Token");

  if (receivedToken !== GAME_SERVER_TOKEN) {
    logApi("system", "internal_request_forbidden", {
      path: req.path,
      hasToken: Boolean(receivedToken),
    });

    return res.status(403).json({ success: false, message: "Invalid game server token." });
  }

  next();
}

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const file of [roundsFile, minesGamesFile, apiLogsFile]) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]\n", "utf8");
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function logApi(game, event, details = {}) {
  const log = {
    id: `${Date.now()}-${Math.random()}`,
    service: "api",
    game,
    event,
    details,
    createdAt: new Date().toISOString(),
  };

  console.log(`[api][${game}] ${event}`, details);

  const logs = readJson(apiLogsFile);
  logs.unshift(log);
  writeJson(apiLogsFile, logs.slice(0, 250));

  return log;
}
