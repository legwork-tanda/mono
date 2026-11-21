import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { FILL, REGULAR, type IconName } from "./icon-paths";
import { Mark } from "./mark";

// Glass + Tape building blocks (docs/design/02-design-system). The classes
// live in app/legwork-components.css; these are the shared strings and pieces.

/** The one yellow pill per screen: the action that moves the job forward. */
export const buttonPrimary = "lw-btn";

/** Glass pill: Call, Message, Decline, Cancel, Add to calendar. */
export const buttonSecondary = "lw-btn lw-btn--secondary";

/** A quiet text button: Start over, Skip, Back. */
export const buttonQuiet = "lw-btn-quiet";

/** Underlined link: Edit, Change, Receipt, Skip. */
export const linkButton = "lw-link";

export const fieldClass = "lw-input";

/** A glass panel. Callers add the padding (18 by default). */
export const cardClass = "lw-glass";

/** The logo pill (S01 floating controls), linking home: `/` by default, or `href` (the tradie view keeps you in it). */
export function Logo({ onPhoto = false, href = "/" }: { onPhoto?: boolean; href?: string }) {
  return (
    <Link
      href={href}
      className={`lw-glass lw-glass--pill lw-press flex h-11 items-center gap-2 pr-4 pl-3 text-[15px] font-semibold ${onPhoto ? "lw-glass--on-photo" : ""}`}
      aria-label="Legwork home"
    >
      <Mark className="h-[17px] w-auto" inverse={onPhoto} />
      <span aria-hidden>Legwork</span>
    </Link>
  );
}

const PHOTOS = {
  pipe: "/photos/hands-pipe.jpg",
  boiler: "/photos/hands-boiler.jpg",
  radiator: "/photos/hands-radiator.jpg",
  spanner: "/photos/hands-spanner.jpg",
} as const;
export type Photo = keyof typeof PHOTOS;

/**
 * The full-bleed black and white photo behind a screen. Blurred and washed
 * behind most screens; sharp only on Home and Booked.
 */
export function PhotoBackdrop({
  photo = "pipe",
  blur = true,
  strong = false,
  position = "50% 40%",
}: {
  photo?: Photo;
  blur?: boolean;
  strong?: boolean;
  position?: string;
}) {
  return (
    <div className="lw-backdrop" aria-hidden>
      <div className={`lw-bg ${blur ? "lw-bg--blur" : ""} ${strong ? "lw-bg--strong" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTOS[photo]} alt="" style={{ objectPosition: position }} />
      </div>
    </div>
  );
}

/** Path of the brand loading animation (frame-by-frame walking boots, animated inside the SVG). */
export const LOADER_SRC = "/legwork-loader.svg";

/** The walking boots on a yellow circle, in a glass bubble with a short status line. */
export function Walking({ label, className = "", size = "size-11" }: { label: string; className?: string; size?: string }) {
  return (
    <div role="status" className={`lw-glass lw-bubble lw-bubble--in inline-flex max-w-full items-center gap-3 py-2 pr-4 pl-2 ${className}`}>
      <span className={`lw-loader ${size}`}>
        {/* An <img> keeps the SVG's own animation running and out of the JS bundle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOADER_SRC} alt="" width={820} height={624} />
      </span>
      <span className="lw-callout text-ink">{label}</span>
    </div>
  );
}

/** Small "working" mark for inside buttons and thumbnails: three dots, never a spinner. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`lw-dots ${className}`}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** The tape loader: the request in flight. Static under Reduce Motion. */
export function TapeLoader({ label = "Waiting for a reply", className = "" }: { label?: string; className?: string }) {
  return <div className={`lw-tape-loader ${className}`} role="progressbar" aria-label={label} aria-busy="true" />;
}

/** A short tape label ("Extra work"). Short words only. */
export function TapeLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`lw-tape-label ${className}`}>{children}</span>;
}

/** A four-step stepper: Describe › When › Check › Book, or Booked › On the way › Arrived › Done. */
export function Stepper({ steps, current, className = "" }: { steps: readonly string[]; current: number; className?: string }) {
  return (
    <div className={className} role="img" aria-label={`Step ${current + 1} of ${steps.length}, ${steps[current]}`}>
      <div className="lw-stepper" style={{ marginTop: 0 }}>
        {steps.map((s, i) => (
          <i key={s} className={i <= current ? "is-done" : ""} />
        ))}
      </div>
      <div className="lw-stepper__labels">
        {steps.map((s, i) => (
          <span key={s} className={i === current ? "is-now" : ""}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The booking stepper's steps (S02–S04). */
export const BOOKING_STEPS = ["Describe", "When", "Check", "Book"] as const;

/**
 * The glass top bar (LWTopBar on iOS): back on the left, the title, a close
 * button on the right, and an optional stepper underneath. Sticky, clear of the notch.
 */
export function TopBar({
  title,
  steps,
  current = 0,
  onBack,
  onClose,
}: {
  title: string;
  steps?: readonly string[];
  current?: number;
  onBack?: (() => void) | null;
  onClose?: () => void;
}) {
  return (
    <header className="lw-flowbar lw-glass lw-glass--bar">
      <div className="lw-flowbar__row">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" className="lw-icon-btn lw-press">
            <Icon name={icons.back} />
          </button>
        ) : (
          <span aria-hidden />
        )}
        <h2 className="lw-flowbar__title">{title}</h2>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close" className="lw-icon-btn lw-press">
            <Icon name={icons.close} />
          </button>
        ) : (
          <span aria-hidden />
        )}
      </div>
      {steps && <Stepper className="lw-flowbar__steps" steps={steps} current={current} />}
    </header>
  );
}

/** An error note: bold caption with a warning-circle icon. Errors are never red. */
export function ErrorNote({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <p id={id} className={`lw-error-note ${className}`}>
      <Icon name="warning-circle" fill />
      <span>{children}</span>
    </p>
  );
}

/**
 * A Phosphor icon (docs/design/06-assets/icons), inlined. Regular by default;
 * `fill` for the active or selected state. `d` draws a one-off stroke path
 * on a 24 grid instead, for the few shapes the set doesn't have.
 */
export function Icon({
  name,
  d,
  fill = false,
  className = "size-5",
  style,
}: {
  name?: IconName;
  d?: string;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (!name) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden
      >
        <path d={d} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" className={className} style={style} aria-hidden>
      <path d={(fill ? FILL : REGULAR)[name]} />
    </svg>
  );
}

export type { IconName };

/** Short names used across the app, mapped to the Phosphor set. */
export const icons = {
  check: "check",
  arrow: "arrow-right",
  back: "arrow-left",
  camera: "camera",
  image: "image",
  upload: "download-simple",
  phone: "phone",
  pin: "map-pin",
  clock: "clock",
  close: "x",
  mic: "microphone",
  locate: "navigation-arrow",
  chat: "chat-circle-text",
  send: "paper-plane-right",
  pencil: "pencil-simple",
  user: "user",
  caretDown: "caret-down",
  caretRight: "caret-right",
  warning: "warning",
  warningCircle: "warning-circle",
  info: "info",
  calendar: "calendar-blank",
  dollar: "currency-dollar",
  truck: "truck",
  star: "star",
  sparkle: "sparkle",
  shield: "shield-check",
  seal: "seal-check",
  lifebuoy: "lifebuoy",
  house: "house",
  plus: "plus",
  receipt: "receipt",
} as const satisfies Record<string, IconName>;

/** A stop square for the dictation button (not in the Phosphor set we ship). */
export const STOP_PATH = "M7 7h10v10H7z";
