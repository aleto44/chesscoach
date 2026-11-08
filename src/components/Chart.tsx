import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";

export interface ChartPoint {
  /** Time in ms (xKind "time") or a running index. */
  x: number;
  y: number;
}

export interface ChartSeries {
  key: string;
  label: string;
  /** 1-based categorical slot (--series-N); follows the entity, never its rank. */
  slot: number;
  points: ChartPoint[];
}

const HEIGHT = 190;
const M = { top: 12, right: 58, bottom: 24, left: 44 };

/** Round tick values covering [min, max], about four of them. */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

const fmtDate = (ms: number, span: number) =>
  new Date(ms).toLocaleDateString(undefined, span > 300 * 86400_000 ? { month: "short", year: "numeric" } : { month: "short", day: "numeric" });

/**
 * A line chart over time (or game by game): one y-axis, thin lines, a crosshair with the value of
 * every line at the pointer, and the latest value labelled at each line's end.
 */
export function LineChart({
  series,
  xKind = "time",
  yLabel,
  format = (y) => String(Math.round(y)),
  xFormat,
  minPad = 10,
}: {
  series: ChartSeries[];
  xKind?: "time" | "index";
  yLabel: string;
  format?: (y: number) => string;
  xFormat?: (x: number) => string;
  /** Least room above and below the data, in y units: 10 suits ratings, small counts want less. */
  minPad?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = series.filter((s) => s.points.length > 0);
  const all = shown.flatMap((s) => s.points);
  const geo = useMemo(() => {
    if (!all.length) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
    const pad = Math.max(minPad, (Math.max(...ys) - Math.min(...ys)) * 0.08);
    const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
    const w = width - M.left - M.right;
    const h = HEIGHT - M.top - M.bottom;
    return {
      x0,
      x1,
      sx: (x: number) => M.left + ((x - x0) / (x1 - x0)) * w,
      sy: (y: number) => M.top + h - ((y - y0) / (y1 - y0)) * h,
      yTicks: ticks(y0, y1),
    };
    // all is rebuilt every render; series identity is what matters
  }, [series, width, minPad]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!geo) return null;
  const { sx, sy, x0, x1, yTicks } = geo;
  const xText = xFormat ?? ((x: number) => (xKind === "time" ? fmtDate(x, x1 - x0) : `#${x + 1}`));

  // End labels, nudged apart so they don't sit on each other.
  const ends = shown
    .map((s) => ({ s, p: s.points[s.points.length - 1] }))
    .map((e) => ({ ...e, y: sy(e.p.y) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);

  /** Each line's point nearest the pointer's x. */
  const nearest = (x: number) =>
    shown.map((s) => ({ s, p: s.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best), s.points[0]) }));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const x = x0 + ((px - M.left) / (width - M.left - M.right)) * (x1 - x0);
    setHover(Math.min(x1, Math.max(x0, x)));
  };
  const at = hover !== null ? nearest(hover) : null;
  const hoverX = at ? sx(at.reduce((best, a) => (Math.abs(a.p.x - hover!) < Math.abs(best - hover!) ? a.p.x : best), at[0].p.x)) : 0;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${yLabel}: ${shown.map((s) => `${s.label} ${format(s.points[s.points.length - 1].y)}`).join(", ")}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} />
            <text className="chart-tick" x={M.left - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        <text className="chart-tick" x={M.left} y={HEIGHT - 6}>
          {xText(x0)}
        </text>
        <text className="chart-tick" x={width - M.right} y={HEIGHT - 6} textAnchor="end">
          {xText(x1)}
        </text>
        {shown.map((s) => (
          <path
            key={s.key}
            className="chart-line"
            style={{ stroke: `var(--series-${s.slot})` }}
            d={s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}
          />
        ))}
        {ends.map(({ s, p, y }) => (
          <g key={s.key}>
            <circle className="chart-dot" cx={sx(p.x)} cy={sy(p.y)} r={4} style={{ fill: `var(--series-${s.slot})` }} />
            <text className="chart-end" x={width - M.right + 8} y={y} dominantBaseline="middle">
              {format(p.y)}
            </text>
          </g>
        ))}
        {at && (
          <g>
            <line className="chart-cross" x1={hoverX} x2={hoverX} y1={M.top} y2={HEIGHT - M.bottom} />
            {at.map(({ s, p }) => (
              <circle key={s.key} className="chart-dot" cx={sx(p.x)} cy={sy(p.y)} r={4} style={{ fill: `var(--series-${s.slot})` }} />
            ))}
          </g>
        )}
      </svg>
      {at && (
        // Right of the crosshair on the left half, left of it on the right half, so it stays inside.
        <div className="chart-tip" style={hoverX < width / 2 ? { left: hoverX + 10 } : { left: hoverX - 10, transform: "translateX(-100%)" }}>
          {at.map(({ s, p }) => (
            <div key={s.key}>
              <span className="chart-swatch" style={{ background: `var(--series-${s.slot})` }} />
              {s.label}: <strong>{format(p.y)}</strong> <span className="muted">{xText(p.x)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The legend: one chip per line, which also shows or hides it. */
export function Legend({
  series,
  hidden,
  onToggle,
  value,
}: {
  series: ChartSeries[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  value?: (s: ChartSeries) => string;
}) {
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <button key={s.key} className={hidden.has(s.key) ? "off" : ""} onClick={() => onToggle(s.key)} aria-pressed={!hidden.has(s.key)}>
          <span className="chart-swatch" style={{ background: `var(--series-${s.slot})` }} />
          {s.label}
          {value && <strong> {value(s)}</strong>}
        </button>
      ))}
    </div>
  );
}
