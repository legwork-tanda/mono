import Link from "next/link";
import { Mark } from "./mark";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export const buttonPrimary = `inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-faint ${focus}`;

export const buttonSecondary = `inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 text-base font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:text-faint ${focus}`;

export const buttonQuiet = `inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-ink ${focus}`;

export const linkButton = `rounded-md text-sm font-semibold text-brand transition-colors hover:text-brand-strong ${focus}`;

export const fieldClass =
  "block w-full rounded-xl border border-line bg-white px-4 py-3 text-base leading-6 text-ink outline-none transition placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/15";

export const cardClass = "rounded-[20px] border border-line bg-white shadow-card";

export function Logo() {
  return (
    <Link href="/" className={`flex items-center gap-2 rounded-lg ${focus}`} aria-label="Legwork home">
      <Mark className="h-7 w-auto text-ink" />
      <span className="text-lg font-bold tracking-tight">Legwork</span>
    </Link>
  );
}

/** Path of the brand loading animation (frame-by-frame walking feet, animated inside the SVG). */
export const LOADER_SRC = "/legwork-loader.svg";

/** The walking feet with a short status line, for anything that takes a moment. */
export function Walking({ label, className = "", size = "h-12" }: { label: string; className?: string; size?: string }) {
  return (
    <div role="status" className={`flex items-center gap-3 ${className}`}>
      {/* An <img> keeps the SVG's own animation running and out of the JS bundle. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOADER_SRC} alt="" width={820} height={624} className={`${size} w-auto shrink-0`} />
      <span className="text-sm font-medium text-muted">{label}</span>
    </div>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Icon({ d, className = "size-5" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export const icons = {
  check: "m5 12.5 4.5 4.5L19 7.5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 18l-6-6 6-6",
  camera:
    "M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  image: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13ZM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15",
  phone: "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM11 18.5h2",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  close: "M6 6l12 12M18 6 6 18",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6",
  stop: "M8 8h8v8H8z",
  locate: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 2v3M12 19v3M2 12h3M19 12h3",
  chat: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-14.5Z",
  send: "M4 12 20 4l-4 16-4-7-8-1ZM12 13l8-9",
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3ZM13.5 8.5l3 3",
};
