"use client";

import { useEffect, useState } from "react";
import type { HandoffResponse } from "@legwork/shared";
import { api } from "@/lib/api";
import type { Session } from "@/lib/session";
import { QrArt } from "./qr-art";
import { Icon, icons } from "./ui";

/** Base URL the QR code points at. NEXT_PUBLIC_SITE_URL overrides it, e.g. a LAN or tunnel URL in dev. */
function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin).replace(/\/$/, "");
}

// Codes last five minutes and work once. A fresh one replaces it well before
// it runs out, so whatever is on screen can always be scanned.
const REFRESH_MS = 2 * 60 * 1000;

/**
 * A QR code that opens this job on a phone, where the customer carries on
 * with everything: photos, the questions, confirming and tracking.
 */
export function PhoneQr({ session }: { session: Session }) {
  const [url, setUrl] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const { id, token, uploadToken } = session;

  useEffect(() => {
    let live = true;
    const base = siteUrl();
    setLocal(/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base));

    const show = async () => {
      try {
        const { code } = await api<HandoffResponse>(`/jobs/${id}/handoff`, { method: "POST", token });
        // In the fragment, so it never reaches a server log.
        const hash = new URLSearchParams({ job: id, code, u: uploadToken });
        if (live) setUrl(`${base}/continue/#${hash}`);
      } catch {
        if (live) setUrl(null);
      }
    };
    void show();
    const timer = setInterval(() => void show(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, token, uploadToken]);

  return (
    <div className="flex flex-col items-center rounded-[20px] border border-line bg-white p-5 text-center">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon d={icons.phone} className="size-4.5 text-brand" />
        Continue on your phone
      </span>
      <div className="mt-4 size-48 rounded-[18px] bg-brand-soft p-2 shadow-card ring-1 ring-drop-line">
        {url ? (
          <QrArt value={url} label="QR code to continue this job on your phone" className="size-full" />
        ) : (
          <div className="size-full animate-pulse rounded-[14px] bg-white" aria-hidden />
        )}
      </div>
      <p className="mt-4 text-sm text-muted text-balance">
        Scan with your camera to take photos and finish there. This screen keeps up.
      </p>
      {local && (
        <p className="mt-2 text-xs text-faint text-balance">
          This points at localhost, so a phone can&apos;t open it. Set NEXT_PUBLIC_SITE_URL to test on a phone.
        </p>
      )}
    </div>
  );
}
