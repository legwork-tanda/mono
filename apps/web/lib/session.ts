/**
 * The job this browser is working on. The owner token lives here: on the
 * desktop that created the job, and on a phone that scanned its QR code.
 */
export type Session = { id: string; token: string; uploadToken: string };

const STORAGE_KEY = "legwork.job";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode etc.: the flow still works, it just won't survive a reload.
  }
}
