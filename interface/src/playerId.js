const PLAYER_ID_STORAGE_KEY = "sd-gamble-player-id";

/**
 * Returns a stable per-browser player id, creating one on first visit.
 * The backend keys the demo balance on this value so it survives
 * reconnects and switching between games.
 */
export function getPlayerId() {
  let playerId = localStorage.getItem(PLAYER_ID_STORAGE_KEY);

  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_STORAGE_KEY, playerId);
  }

  return playerId;
}
