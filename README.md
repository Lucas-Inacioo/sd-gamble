# Distributed Casino Demo — Supabase deployment version

Academic simulator with three games: **Crash**, **Mines**, and **Double**.

## Architecture

- `interface/`: React/Vite browser interface. Deploy to Vercel.
- `backend/`: one persistent Node.js web service exposing both REST and Socket.IO. Deploy to Render.
- `supabase/`: PostgreSQL schema. Run once in the Supabase SQL Editor.

The server keeps authoritative game secrets. The frontend only renders state and animations.

## Important security note

No database password, Supabase key, token, or `.env` file is included in this repository. Keep all secrets out of Git. The interface does **not** connect directly to Supabase.

## Local execution

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `DATABASE_URL` and `DATABASE_SSL=false` for local use.
3. Copy `interface/.env.example` to `interface/.env`.
4. Run `npm run install:all` at the repository root.
5. In terminal 1 run `npm run dev:backend`.
6. In terminal 2 run `npm run dev:web`.
7. Open `http://localhost:5173`.

## Production deployment

See the deployment steps supplied with this migration. In production, both `VITE_BACKEND_URL` and CORS must point at the final Render/Vercel URLs.
