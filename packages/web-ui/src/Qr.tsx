import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code to scan with a phone: black squares on white whatever the theme (an inverted code fails in many scanners), drawn
 * as one SVG path so it stays sharp at any size. `label` says what it holds for a screen reader.
 */
export function Qr({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value);
    q.make();
    const count = q.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [value]);
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}
