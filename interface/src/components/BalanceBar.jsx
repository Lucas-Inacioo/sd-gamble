import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { GAME_SERVER_URL } from "../config.js";
import { getPlayerId } from "../playerId.js";

/**
 * Global balance display shown above every game.
 *
 * Keeps its own socket connection (independent of whichever game is
 * mounted) so the amount stays visible and live while switching games.
 */
export default function BalanceBar() {
  const [balance, setBalance] = useState(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const socket = io(GAME_SERVER_URL, {
      transports: ["websocket", "polling"],
      auth: { playerId: getPlayerId() },
    });

    socket.on("connect", () => setStatus("connected"));
    socket.on("connect_error", () => setStatus("connection error"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("balance_update", (data) => setBalance(Number(data.balance)));

    return () => socket.disconnect();
  }, []);

  return (
    <div className="balance-bar" aria-live="polite">
      <span className="balance-bar__label">Balance</span>
      <strong className="balance-bar__value">
        {balance === null ? "—" : formatCredits(balance)}
      </strong>
      {status !== "connected" && (
        <span className="balance-bar__status">{status}</span>
      )}
    </div>
  );
}

function formatCredits(value) {
  return `${value.toFixed(2)} credits`;
}
