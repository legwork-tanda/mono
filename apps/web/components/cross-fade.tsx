"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * One calm transition per state change: when `id` changes, the old content
 * fades out while the new fades in, both in the same grid cell, so the
 * layout doesn't jump (the cell holds the taller of the two until the old
 * one is gone). Reduce Motion skips straight to the new content.
 */
export function CrossFade({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const [shown, setShown] = useState({ id, node: children });
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);

  // A new state: keep a snapshot of the old one to fade out.
  if (shown.id !== id) {
    setLeaving(shown);
    setShown({ id, node: children });
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 320);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div className={`lw-xfade ${className}`}>
      {leaving && (
        <div key={`out-${leaving.id}`} className="lw-xfade__out" aria-hidden>
          {leaving.node}
        </div>
      )}
      <div key={`in-${id}`} className={leaving ? "lw-xfade__in" : undefined}>
        {children}
      </div>
    </div>
  );
}
