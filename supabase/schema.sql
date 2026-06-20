create extension if not exists pgcrypto;

create table if not exists crash_rounds (
  id uuid primary key default gen_random_uuid(),
  external_round_id text unique not null,
  crash_point numeric(12, 2) not null,
  server_seed text not null,
  public_seed text not null,
  server_seed_commitment text not null,
  started_at timestamptz not null,
  crashed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists mines_games (
  id uuid primary key default gen_random_uuid(),
  external_game_id text unique not null,
  status text not null,
  mines_count integer not null,
  revealed_tiles jsonb not null default '[]'::jsonb,
  mine_positions jsonb not null default '[]'::jsonb,
  payout_multiplier numeric(12, 2) not null,
  server_seed text not null,
  public_seed text not null,
  server_seed_commitment text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists double_rounds (
  id uuid primary key default gen_random_uuid(),
  external_round_id text unique not null,
  selected_color text not null,
  result_number integer not null,
  result_color text not null,
  won boolean not null,
  payout_multiplier numeric(12, 2) not null,
  server_seed text not null,
  public_seed text not null,
  server_seed_commitment text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  game text not null,
  event text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crash_rounds_crashed_at on crash_rounds (crashed_at desc);
create index if not exists idx_mines_games_finished_at on mines_games (finished_at desc);
create index if not exists idx_double_rounds_finished_at on double_rounds (finished_at desc);
create index if not exists idx_audit_logs_created_at on audit_logs (created_at desc);
