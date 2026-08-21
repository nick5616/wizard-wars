const STORAGE_KEY = 'wizardwars_client_id';

/**
 * Stable per-browser identity, persisted in localStorage (same pattern as
 * audioStore's persisted settings). Sent to the server on connect so it can
 * look up and restore a previous session's name/class/level/progress --
 * see server/src/GameServer.js onConnection.
 */
export function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private browsing, etc.) -- fall back to a
    // session-only id so the game still works, just without persistence.
    return crypto.randomUUID();
  }
}
