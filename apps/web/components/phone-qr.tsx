"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon, icons } from "./ui";

/** Base URL the QR code points at. NEXT_PUBLIC_SITE_URL overrides it, e.g. a LAN or tunnel URL in dev. */
function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin).replace(/\/$/, "");
}

/** A QR code that opens the phone upload page for this job. */
export function PhoneQr({ jobId, uploadToken }: { jobId: string; uploadToken: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [local, setLocal] = useState(false);

  useEffect(() => {
    const base = siteUrl();
    const url = `${base}/upload/?job=${encodeURIComponent(jobId)}&t=${encodeURIComponent(uploadToken)}`;
    setLocal(/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base));
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#10203a", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [jobId, uploadToken]);

  return (
    <div className="flex flex-col items-center rounded-[20px] border border-line bg-white p-5 text-center">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon d={icons.phone} className="size-4.5 text-brand" />
        Add from your phone
      </span>
      <div
        className="mt-4 size-32 [&>svg]:size-full"
        role="img"
        aria-label="QR code to add photos from your phone"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p className="mt-4 text-sm text-muted text-balance">
        Point your camera at the code. Photos you take land here.
      </p>
      {local && (
        <p className="mt-2 text-xs text-faint text-balance">
          This points at localhost, so a phone can&apos;t open it. Set NEXT_PUBLIC_SITE_URL to test on a phone.
        </p>
      )}
    </div>
  );
}
