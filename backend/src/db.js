const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Add it to backend/.env or your hosting provider variables.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
});

async function query(text, values = []) {
  return pool.query(text, values);
}

async function checkDatabase() {
  await query("select 1 as ok");
}

async function addLog(source, game, event, details = {}) {
  await query(
    `
      insert into audit_logs (source, game, event, details)
      values ($1, $2, $3, $4::jsonb)
    `,
    [source, game, event, JSON.stringify(details)]
  );
}

async function saveCrashRound(round) {
  await query(
    `
      insert into crash_rounds (
        external_round_id,
        crash_point,
        server_seed,
        public_seed,
        server_seed_commitment,
        started_at,
        crashed_at
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (external_round_id) do nothing
    `,
    [
      round.externalRoundId,
      round.crashPoint,
      round.serverSeed,
      round.publicSeed,
      round.serverSeedCommitment,
      new Date(round.startedAtMs),
      new Date(round.crashedAtMs),
    ]
  );
}

async function saveMinesGame(game) {
  await query(
    `
      insert into mines_games (
        external_game_id,
        status,
        mines_count,
        revealed_tiles,
        mine_positions,
        payout_multiplier,
        server_seed,
        public_seed,
        server_seed_commitment,
        started_at,
        finished_at
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11)
      on conflict (external_game_id) do nothing
    `,
    [
      game.externalGameId,
      game.status,
      game.minesCount,
      JSON.stringify(game.revealedTiles),
      JSON.stringify(game.minePositions),
      game.payoutMultiplier,
      game.serverSeed,
      game.publicSeed,
      game.serverSeedCommitment,
      new Date(game.startedAtMs),
      new Date(game.finishedAtMs),
    ]
  );
}

async function saveDoubleRound(round) {
  await query(
    `
      insert into double_rounds (
        external_round_id,
        selected_color,
        result_number,
        result_color,
        won,
        payout_multiplier,
        server_seed,
        public_seed,
        server_seed_commitment,
        started_at,
        finished_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (external_round_id) do nothing
    `,
    [
      round.externalRoundId,
      round.selectedColor,
      round.resultNumber,
      round.resultColor,
      round.won,
      round.payoutMultiplier,
      round.serverSeed,
      round.publicSeed,
      round.serverSeedCommitment,
      new Date(round.startedAtMs),
      new Date(round.finishedAtMs),
    ]
  );
}

module.exports = {
  query,
  checkDatabase,
  addLog,
  saveCrashRound,
  saveMinesGame,
  saveDoubleRound,
};
