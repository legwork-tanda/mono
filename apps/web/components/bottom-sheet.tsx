"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The glass sheet over the map (S05b, S08), as the iOS sheet with detents:
 * 8px from the screen edges, tape along the top, a grabber you drag or tap to
 * move between heights, and content that scrolls inside it. Never taller than
 * its content, and never under the top bar. The page behind doesn't move.
 *
 * `onSettle` reports the height once it stops moving, so the map can keep
 * what matters in view above it.
 */
export function BottomSheet({
  label,
  snaps = [0.34, 0.5, 0.92],
  initial = 1,
  onSettle,
  children,
}: {
  label: string;
  /** Heights as fractions of the screen, lowest first. */
  snaps?: readonly number[];
  initial?: number;
  /** Where the sheet sits once still: its height on a phone, or its width as a side panel (desktop). */
  onSettle?: (inset: { bottom: number; left: number }) => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const topProbe = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState(0);
  const [natural, setNatural] = useState(0);
  const [topSpace, setTopSpace] = useState(0);
  const [index, setIndex] = useState(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ y: number; start: number; t: number; v: number; moved: boolean } | null>(null);
  const moved = useRef(false);

  // The screen, the space the top bar keeps, and the content's own height.
  useLayoutEffect(() => {
    const scene = sheet.current?.parentElement;
    if (!scene || !body.current || !handle.current) return;
    const measure = () => {
      setScreen(scene.clientHeight);
      setTopSpace(topProbe.current?.offsetHeight ?? 0);
      setNatural(handle.current!.offsetHeight + body.current!.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(160, screen - topSpace - 8);
  const heights = [...new Set(snaps.map((f) => Math.round(Math.min(f * screen, max, natural || Infinity))))].sort((a, b) => a - b);
  const at = Math.min(index, heights.length - 1);
  const settled = heights[at] ?? 0;
  const height = drag ?? settled;

  // From 1024px wide it's a glass side panel next to the map: no detents, no drag.
  const desktop = useDesktop();
  useEffect(() => {
    if (drag !== null) return;
    if (desktop) {
      const el = sheet.current;
      if (el) onSettle?.({ bottom: 0, left: el.offsetLeft + el.offsetWidth });
    } else if (settled > 0) onSettle?.({ bottom: settled + 8, left: 0 });
  }, [settled, drag, onSettle, desktop]);

  const nearest = (h: number) => heights.reduce((best, x, i) => (Math.abs(x - h) < Math.abs(heights[best]! - h) ? i : best), 0);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { y: e.clientY, start: settled, t: e.timeStamp, v: 0, moved: false };
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dy = g.y - e.clientY;
    if (!g.moved && Math.abs(dy) < 4) return;
    g.moved = true;
    moved.current = true;
    const next = g.start + dy;
    const lo = heights[0] ?? 0;
    const hi = heights.at(-1) ?? 0;
    // Past either end it gives a little, like the iOS sheet.
    const eased = next < lo ? lo - (lo - next) / 3 : next > hi ? hi + (next - hi) / 3 : next;
    const dt = Math.max(1, e.timeStamp - g.t);
    g.v = (eased - (drag ?? g.start)) / dt;
    g.t = e.timeStamp;
    setDrag(eased);
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved || drag === null) return setDrag(null);
    // Throw it: where it would be in 180ms at this speed.
    setIndex(nearest(drag + g.v * 180));
    setDrag(null);
  };

  /** Tap or Enter on the grabber: up a step, or back to the lowest from the top. */
  const cycle = useCallback(() => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setIndex((i) => (Math.min(i, heights.length - 1) >= heights.length - 1 ? 0 : Math.min(i, heights.length - 1) + 1));
  }, [heights.length]);

  const expanded = at === heights.length - 1;

  return (
    <>
      <div ref={topProbe} aria-hidden className="lw-sheet-probe" />
      <section
        ref={sheet}
        aria-label={label}
        className="lw-sheet lw-glass lw-glass--sheet lw-tape-top"
        data-dragging={drag !== null || undefined}
        style={{ height: !desktop && height > 0 ? height : undefined }}
      >
        <button
          ref={handle}
          type="button"
          className="lw-sheet__handle"
          aria-label={expanded ? "Make the sheet smaller" : "Make the sheet bigger"}
          aria-expanded={expanded}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          onClick={cycle}
        >
          <span className="lw-grabber" />
        </button>
        <div className="lw-sheet__scroll">
          <div ref={body} className="lw-sheet__body">
            {children}
          </div>
        </div>
      </section>
    </>
  );
}

const DESKTOP = "(min-width: 1024px)";

/** True from the desktop breakpoint up (1024px, as the rest of the app). */
export function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}
