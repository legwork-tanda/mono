"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradeId } from "@legwork/shared";

// Licences and certificates a tradie can upload to show they're qualified.
// A demo for now: nothing goes to the API, the file never leaves the phone,
// and the "check" is a timer. Matching ignores it, so a tradie with nothing
// uploaded still gets offers. Kept in localStorage per tradie.

export type CredentialId = TradeId | "insurance";

export type Credential = {
  fileName: string;
  /** The licence or policy number they typed, if any. */
  number: string;
  uploadedAt: string;
  /** When the pretend check finishes. */
  verifiedAt: string;
};

type Store = Partial<Record<CredentialId, Credential>>;

/** How long the pretend check takes. */
const CHECK_MS = 4000;

/** What each trade's document is called. */
const DOC_NAME: Record<TradeId, string> = {
  plumbing: "Plumbing licence",
  electrical: "Electrical contractor licence",
  carpentry_handyman: "Builder or carpentry licence",
  roofing_gutters: "Roofing licence",
  painting: "Painting licence",
  tiling: "Wall and floor tiling licence",
  locksmith: "Locksmith licence",
  appliance_repair: "Appliance or gas fitting certificate",
  plastering: "Plastering licence",
  fencing_landscaping: "Landscaping or fencing licence",
};

export const credentialName = (id: CredentialId) => (id === "insurance" ? "Public liability insurance" : DOC_NAME[id]);

const key = (tradieId: string) => `legwork:credentials:${tradieId}`;

function read(tradieId: string): Store {
  try {
    return JSON.parse(localStorage.getItem(key(tradieId)) ?? "{}") as Store;
  } catch {
    return {};
  }
}

export type CredentialStatus = "missing" | "checking" | "verified";

export const statusOf = (c: Credential | undefined, now: number): CredentialStatus =>
  !c ? "missing" : Date.parse(c.verifiedAt) <= now ? "verified" : "checking";

/** The tradie's credentials, plus a clock that ticks while a check is running. */
export function useCredentials(tradieId: string | undefined) {
  const [store, setStore] = useState<Store>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (tradieId) setStore(read(tradieId));
  }, [tradieId]);

  const checking = Object.values(store).some((c) => c && Date.parse(c.verifiedAt) > now);
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [checking]);

  const save = useCallback(
    (next: Store) => {
      if (!tradieId) return;
      setStore(next);
      localStorage.setItem(key(tradieId), JSON.stringify(next));
    },
    [tradieId],
  );

  const upload = useCallback(
    (id: CredentialId, fileName: string, number: string) => {
      const at = Date.now();
      setNow(at);
      save({
        ...store,
        [id]: { fileName, number, uploadedAt: new Date(at).toISOString(), verifiedAt: new Date(at + CHECK_MS).toISOString() },
      });
    },
    [store, save],
  );

  const remove = useCallback(
    (id: CredentialId) => {
      const next = { ...store };
      delete next[id];
      save(next);
    },
    [store, save],
  );

  return { store, now, upload, remove };
}
