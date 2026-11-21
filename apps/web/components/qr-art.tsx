// A clean QR code: square ink modules and rounded corner "eyes", drawn from the
// raw module grid so it stays crisp at any size. No logo inside the code, so
// error correction can stay at M and the grid stays as sparse as possible; the
// brand lives in the ink frame around it (see PhoneQr).

import { useMemo } from "react";
import QRCode from "qrcode";

// Always ink on a white tile, in both themes, so every scanner reads it.
const INK = "#1D1D1F";

type Props = { value: string; label: string; className?: string };

export function QrArt({ value, label, className }: Props) {
  const { n, path, finders } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const finders = [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const;
    const inFinder = (r: number, c: number) => finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);
    // One path of horizontal runs: fewer nodes than a rect per module, and no
    // hairline seams between neighbours.
    let path = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (qr.modules.get(r, c) === 1 && !inFinder(r, c)) {
          const start = c;
          while (c < n && qr.modules.get(r, c) === 1 && !inFinder(r, c)) c++;
          path += `M${start} ${r}h${c - start}v1h${start - c}z`;
        } else c++;
      }
    }
    return { n, path, finders };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} role="img" aria-label={label}>
      <path d={path} fill={INK} shapeRendering="crispEdges" />
      {finders.map(([r, c]) => (
        <g key={`${r}-${c}`}>
          <rect x={c + 0.5} y={r + 0.5} width={6} height={6} rx={1.4} fill="none" stroke={INK} strokeWidth={1} />
          <rect x={c + 2} y={r + 2} width={3} height={3} rx={0.7} fill={INK} />
        </g>
      ))}
    </svg>
  );
}
