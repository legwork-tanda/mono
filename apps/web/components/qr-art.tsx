// A QR code in the Legwork style: rounded ink dots, brand-blue rounded finder
// squares and the walking-legs mark in the middle. Drawn from the raw module
// grid so it stays crisp at any size. Error correction is Q (about 25%), which
// leaves room for the logo tile (about 5% of the area) while keeping the modules big enough for a quick scan.

import { useMemo } from "react";
import QRCode from "qrcode";
import { MarkGlyph } from "./mark";

const INK = "#0c1f3f";
const BRAND = "#245fd9";
const QUIET = 2; // modules of white border, so scanners find the edge

type Props = { value: string; label: string; className?: string };

export function QrArt({ value, label, className }: Props) {
  const qr = useMemo(() => QRCode.create(value, { errorCorrectionLevel: "Q" }), [value]);
  const n = qr.modules.size;
  const at = (r: number, c: number) => qr.modules.get(r, c) === 1;

  // The three finder patterns (7x7 in the corners) are drawn as shapes, not dots.
  const finders = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const;
  const inFinder = (r: number, c: number) => finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);

  // Clear a square in the middle for the logo tile (about 22% of the width, odd-sized so it centres).
  let hole = Math.round(n * 0.22);
  if (hole % 2 === 0) hole += 1;
  const holeStart = (n - hole) / 2;
  const inHole = (r: number, c: number) => r >= holeStart && r < holeStart + hole && c >= holeStart && c < holeStart + hole;

  const dots: { r: number; c: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (at(r, c) && !inFinder(r, c) && !inHole(r, c)) dots.push({ r, c });
    }
  }

  const size = n + QUIET * 2;
  const o = QUIET;
  const markWidth = hole - 1.6;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label={label} shapeRendering="geometricPrecision">
      <rect width={size} height={size} rx={2.4} fill="#ffffff" />
      {dots.map(({ r, c }) => (
        <circle key={`${r}-${c}`} cx={o + c + 0.5} cy={o + r + 0.5} r={0.45} fill={INK} />
      ))}
      {finders.map(([r, c]) => (
        <g key={`${r}-${c}`}>
          {/* Outer ring: 7 modules wide, 1 module thick. */}
          <rect x={o + c + 0.5} y={o + r + 0.5} width={6} height={6} rx={1.9} fill="none" stroke={BRAND} strokeWidth={1} />
          {/* Centre: 3x3. */}
          <rect x={o + c + 2} y={o + r + 2} width={3} height={3} rx={0.9} fill={INK} />
        </g>
      ))}
      <rect x={o + holeStart + 0.3} y={o + holeStart + 0.3} width={hole - 0.6} height={hole - 0.6} rx={1.4} fill="#ffffff" stroke={BRAND} strokeWidth={0.35} />
      <MarkGlyph x={o + holeStart + 0.8} y={o + holeStart + (hole - (markWidth * 716) / 928) / 2} width={markWidth} fill={BRAND} />
    </svg>
  );
}
