"use client";

import { useEffect, useState } from "react";
import type { HandoffResponse } from "@legwork/shared";
import { api } from "@/lib/api";
import type { Session } from "@/lib/session";
import { Mark } from "./mark";
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
    <div className="lw-glass flex flex-col items-center p-[18px] text-center">
      <span className="lw-headline flex items-center gap-2 text-[15px]">
        <Icon name={icons.phone} className="size-5" />
        Continue on your phone
      </span>
      {/* The code sits on a white tile inside an ink frame, in both themes. The
          white tile doubles as the quiet zone scanners need around the code. */}
      <div className="mt-4 flex w-52 flex-col items-center rounded-[22px] bg-[#1D1D1F] p-2.5 pb-1.5">
        <div className="size-47 rounded-[14px] bg-[#fff] p-2.5">
          {url ? (
            <QrArt value={url} label="QR code to continue this job on your phone" className="size-full" />
          ) : (
            <div className="size-full rounded-lg bg-[#F5F5F7]" aria-hidden />
          )}
        </div>
        <span className="flex items-center gap-1.5 pt-1.5 pb-0.5 text-[13px] font-bold text-[#fff]">
          <Mark className="h-3.5 w-auto" inverse />
          Scan me
        </span>
      </div>
      <p className="lw-caption mt-4 text-muted text-balance">
        Scan with your camera to take photos and finish there. This screen keeps up.
      </p>
      {local && (
        <p className="lw-footnote mt-2 text-faint text-balance">
          This points at localhost, so a phone can&apos;t open it. Set NEXT_PUBLIC_SITE_URL to test on a phone.
        </p>
      )}
    </div>
  );
}
