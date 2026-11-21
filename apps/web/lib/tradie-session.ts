import type { TradieProfile } from "@legwork/shared";

/**
 * The live tradie signed in on this phone. There's no password: the token is
 * the identity, so it stays here (apart from the customer's job session) until
 * they sign out.
 */
export type TradieSession = { token: string; tradie: TradieProfile };

const STORAGE_KEY = "legwork.tradie";

export function loadTradieSession(): TradieSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TradieSession) : null;
  } catch {
    return null;
  }
}

export function saveTradieSession(session: TradieSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: they'll need to sign up again after a reload.
  }
}
