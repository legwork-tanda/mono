"use client";

import { useState } from "react";
import type { PriceRange } from "@legwork/shared";
import { fieldClass } from "@/components/ui";
import { money } from "./bits";

const clamp = (n: number, r: PriceRange) => Math.min(r.max, Math.max(r.min, Math.round(n)));

/**
 * A quote that can only be inside the locked range: a slider for the thumb and
 * a number field for an exact figure, clamped when it loses focus. The server
 * still checks.
 */
export function QuoteInput({ range, value, onChange }: { range: PriceRange; value: number; onChange: (n: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const step = range.max - range.min >= 100 ? 5 : 1;
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor="quote" className="text-sm font-semibold">
          Your quote
        </label>
        <div className="relative w-36">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-lg font-semibold text-muted">$</span>
          <input
            id="quote"
            inputMode="numeric"
            value={typed ?? String(value)}
            onChange={(e) => {
              const text = e.target.value.replace(/[^\d]/g, "");
              setTyped(text);
              const n = Number(text);
              if (text && n >= range.min && n <= range.max) onChange(n);
            }}
            onBlur={() => {
              if (typed !== null) onChange(clamp(Number(typed) || range.min, range));
              setTyped(null);
            }}
            className={`${fieldClass} pl-8 text-right text-lg font-semibold tabular-nums`}
          />
        </div>
      </div>
      <input
        type="range"
        aria-label="Quote"
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        onChange={(e) => {
          setTyped(null);
          onChange(clamp(Number(e.target.value), range));
        }}
        className="w-full accent-brand"
      />
      <div className="flex justify-between text-xs font-semibold text-muted tabular-nums">
        <span>{money(range.min)}</span>
        <span>{money(range.max)}</span>
      </div>
    </div>
  );
}
