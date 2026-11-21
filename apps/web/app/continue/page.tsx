"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RedeemHandoffRequest, RedeemHandoffResponse } from "@legwork/shared";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/session";
import { ErrorNote, Logo, PhotoBackdrop, Walking } from "@/components/ui";

// Opened from the QR code on the desktop. The link's fragment (never sent to
// a server) carries the job id, the upload token for photos, and a one-time
// handoff code. The code is traded for this phone's own owner token, the job
// is saved here like any other, and the customer carries on at the home page.

// Redeems each code once, even when React runs the effect twice in development.
const redeeming = new Map<string, Promise<RedeemHandoffResponse>>();

function redeem(jobId: string, code: string) {
  let pending = redeeming.get(code);
  if (!pending) {
    pending = api<RedeemHandoffResponse>("/handoff", {
      method: "POST",
      json: { jobId, code } satisfies RedeemHandoffRequest,
    });
    redeeming.set(code, pending);
  }
  return pending;
}

export default function ContinuePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const jobId = params.get("job") ?? "";
    const code = params.get("code") ?? "";
    const uploadToken = params.get("u") ?? "";
    if (!jobId || !code || !uploadToken) {
      // A second run of this effect finds the fragment already cleared by the first.
      if (!redeeming.size) setError("This link isn't complete. Scan the QR code again.");
      return;
    }
    // Out of the address bar and history: the code is spent either way.
    window.history.replaceState(null, "", window.location.pathname);

    redeem(jobId, code)
      .then(({ token }) => {
        saveSession({ id: jobId, token, uploadToken });
        router.replace("/");
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <>
      <PhotoBackdrop photo="spanner" />
      <div className="lw-screen">
        <header className="lw-appbar">
          <Logo />
        </header>
        <main className="lw-screen__body pt-10">
          {error ? (
            <div role="alert" className="lw-glass is-error p-[18px]">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : (
            <Walking label="Opening your job…" />
          )}
        </main>
      </div>
    </>
  );
}
