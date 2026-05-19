// Single import point for all API services
// Usage: import { getMedia, saveProgress, addToWatchlist } from "../api";

export * from "./media";
export * from "./library";
export * from "./categories";
export * from "./metadata";
export * from "./history";
export * from "./user";
export { api } from "./client";
export * from "./stream";

export { default as PlayerPage } from "../Pages/Player/PlayerPage";
export { PlayerProvider, usePlayerState } from "../Pages/Player/UsePlayerState";
export { useProgress } from "../Pages/Player/useProgress";
