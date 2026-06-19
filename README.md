# Distributed Casino Demo: Crash + Mines

This is a clean test project with three independent parts:

```text
api/           data and persistence service
game-server/   computation and real-time Socket.IO service
interface/     React interface
```

It demonstrates the split expected in a distributed systems project:

- **Interface**: renders state and sends user intentions.
- **Computation server**: owns hidden game state and real-time decisions.
- **API**: persists completed games and exposes history/logs.

## Games included

### Crash

The frontend does not know the crash point while the round is active. The game server emits public multiplier updates and reveals the crash point only in `round_crashed`.

### Mines

The frontend does not know mine positions while the game is active. The game server receives tile selections, decides whether the tile is safe or a mine, and reveals mine positions only after loss or cash out.

## Logs for the final paper

Both games show:

- Socket events received by the interface.
- Game server logs emitted from the computation service.
- API logs fetched from the persistence service.
- API history records.

These panels are useful evidence for explaining component responsibilities and communication flow in the final report.

## Install

```bash
cd distributed-casino-demo-full
npm run install:all
```

## Run

Use three terminals.

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:game
```

Terminal 3:

```bash
npm run dev:web
```

Open:

```text
http://localhost:5173
```

## Ports

```text
API:         http://localhost:4000
Game server: http://localhost:3001
Interface:   http://localhost:5173
```

## Notes

This is a classroom/demo implementation. It is intentionally simple and uses JSON files as storage. It is not a production gambling implementation.
