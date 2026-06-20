const backendUrl = (import.meta.env.VITE_BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");

export const API_BASE_URL = backendUrl;
export const GAME_SERVER_URL = backendUrl;
