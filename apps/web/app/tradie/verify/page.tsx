"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useTradie } from "@/components/tradie/tradie-context";
import { credentialName, statusOf, useCredentials, type CredentialId, type CredentialStatus } from "@/components/tradie/credentials";
import { buttonPrimary, buttonQuiet, cardClass, fieldClass, Icon, icons, linkButton, Walking } from "@/components/ui";

// Licences & certificates: one row per trade the tradie works in, plus their
// insurance. A preview of verification. Uploads stay on this phone and are
// "checked" after a few seconds; offers keep coming whether or not they upload.

const STATUS_TEXT: Record<CredentialStatus, string> = {
  missing: "Not uploaded",
  checking: "Checking…",
  verified: "Verified",
};

export default function TradieVerifyPage() {
  const { session } = useTradie();
  const { store, now, upload, remove } = useCredentials(session?.tradie.id);
  const [open, setOpen] = useState<CredentialId | null>(null);

  if (!session) return <Walking label="Loading…" />;
  const ids: CredentialId[] = [...session.tradie.trades, "insurance"];
  const verified = ids.filter((id) => statusOf(store[id], now) === "verified").length;

  return (
    <div className="lw-screen">
      <header className="lw-appbar">
        <Link href="/tradie/me/" className="lw-glass lw-glass--circle lw-press" aria-label="Back to your profile">
          <Icon name={icons.back} />
        </Link>
        <h1 className="lw-headline">Licences</h1>
        <span className="size-11 shrink-0" aria-hidden />
      </header>
      <main className="lw-screen__body gap-4">
        <section className={`${cardClass} space-y-2 p-5`}>
          <div className="flex items-center gap-3">
            <span className="lw-initials" aria-hidden>
              <Icon name={icons.seal} fill={verified === ids.length} />
            </span>
            <div className="min-w-0">
              <p className="lw-headline">
                <span className="lw-num">{verified}</span> of <span className="lw-num">{ids.length}</span> verified
              </p>
              <p className="lw-caption lw-c2">People see a Verified badge on your card when you bid.</p>
            </div>
          </div>
        </section>

        <section aria-label="Your documents" className="space-y-3">
          <h2 className="lw-section-label">Your documents</h2>
          <ul className="space-y-3">
            {ids.map((id) => (
              <CredentialRow
                key={id}
                id={id}
                status={statusOf(store[id], now)}
                fileName={store[id]?.fileName}
                number={store[id]?.number}
                open={open === id}
                onToggle={() => setOpen(open === id ? null : id)}
                onUpload={(fileName, number) => {
                  upload(id, fileName, number);
                  setOpen(null);
                }}
                onRemove={() => remove(id)}
              />
            ))}
          </ul>
        </section>

        <div className="lw-note lw-glass">
          <Icon name={icons.info} />
          <p className="text-pretty">
            This is a preview. Your files stay on this phone and nothing is really checked yet. You get job offers either way.
          </p>
        </div>
      </main>
    </div>
  );
}

function CredentialRow({
  id,
  status,
  fileName,
  number,
  open,
  onToggle,
  onUpload,
  onRemove,
}: {
  id: CredentialId;
  status: CredentialStatus;
  fileName?: string;
  number?: string;
  open: boolean;
  onToggle: () => void;
  onUpload: (fileName: string, number: string) => void;
  onRemove: () => void;
}) {
  const name = credentialName(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [num, setNum] = useState("");
  const inputId = `cred-${id}`;

  return (
    <li className={`${cardClass} p-4`}>
      <div className="flex items-center gap-3">
        <span className="lw-initials" aria-hidden>
          <Icon name={status === "verified" ? icons.seal : id === "insurance" ? icons.shield : "identification-card"} fill={status === "verified"} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="lw-headline text-base">{name}</p>
          <p className="lw-caption lw-c2 truncate" aria-live="polite">
            {STATUS_TEXT[status]}
            {status !== "missing" && fileName ? ` · ${fileName}` : ""}
          </p>
          {status !== "missing" && number && <p className="lw-footnote lw-c3 lw-num">No. {number}</p>}
        </div>
        {status === "verified" && <span className="lw-badge">Verified</span>}
        {status === "missing" && (
          <button type="button" onClick={onToggle} aria-expanded={open} className={`${buttonQuiet} shrink-0`}>
            {open ? "Cancel" : "Upload"}
          </button>
        )}
      </div>

      {status === "verified" && (
        <button type="button" onClick={onRemove} className={`${linkButton} mt-2 min-h-11`}>
          Replace
        </button>
      )}

      {open && status === "missing" && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (file) onUpload(file.name, num.trim());
          }}
        >
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label htmlFor={inputId} className="lw-inner lw-press flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3">
            <Icon name={file ? icons.check : icons.camera} />
            <span className="min-w-0 flex-1">
              <span className="lw-headline block truncate text-base">{file ? file.name : "Take a photo or choose a file"}</span>
              <span className="lw-caption lw-c2 block">{file ? "Tap to choose another" : "Photo or PDF of the card or certificate"}</span>
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="lw-caption lw-c2 block px-1">{id === "insurance" ? "Policy number" : "Licence number"} (optional)</span>
            <input value={num} onChange={(e) => setNum(e.target.value)} className={fieldClass} inputMode="text" autoComplete="off" placeholder="e.g. 123456C" />
          </label>
          <button type="submit" disabled={!file} className={`${buttonPrimary} w-full`}>
            Send for checking
          </button>
        </form>
      )}
    </li>
  );
}
