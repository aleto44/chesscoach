// Small bar charts for the Profile's weakness dashboard. Plain HTML, so they size with the column;
// every bar carries its value as text, so nothing is told by color alone.
import type { ReactNode } from "react";

export interface Part {
  key: string;
  label: string;
  value: number;
  /** A CSS color, normally a var(--…) token. */
  color: string;
}

/**
 * One bar split into parts (wins/draws/losses, error kinds), with a legend under it that names
 * each part and its value. Hovering a segment shows its share.
 */
export function StackBar({ parts, format = (v) => String(v) }: { parts: Part[]; format?: (v: number) => string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return null;
  return (
    <div className="stackbar">
      <div className="stackbar-track" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.key} className="stackbar-seg" style={{ flexGrow: p.value, background: p.color }}>
              <span className="bar-tip">
                {p.label}: <strong>{format(p.value)}</strong> ({Math.round((100 * p.value) / total)}%)
              </span>
            </div>
          ))}
      </div>
      <div className="stackbar-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <span className="chart-swatch" style={{ background: p.color }} />
            {p.label} <strong>{format(p.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export interface Row {
  key: string;
  label: ReactNode;
  /** Small text under the label, e.g. how many games. */
  sub?: ReactNode;
  /** The bar: one or more stacked parts, in the row's own units. */
  parts: { value: number; color: string; label: string }[];
  /** The value printed at the bar's end. */
  value: string;
  /** Marks the row the text talks about (the worst phase, say). */
  strong?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

/**
 * Horizontal bars on one shared scale, one row each, with an optional dashed reference line
 * (the overall average, 50% score) so a row reads as "above" or "below" at a glance.
 */
export function BarRows({
  rows,
  max,
  reference,
  referenceLabel,
}: {
  rows: Row[];
  max: number;
  reference?: number;
  referenceLabel?: string;
}) {
  const pct = (v: number) => `${Math.min(100, (100 * v) / Math.max(max, 1e-9))}%`;
  return (
    <div className="barrows">
      {rows.map((r) => {
        const body = (
          <>
            <div className="barrow-label">
              <span className={r.strong ? "strong" : ""}>{r.label}</span>
              {r.sub && <span className="muted small">{r.sub}</span>}
            </div>
            <div className="barrow-track">
              <div className="barrow-fill">
                {r.parts
                  .filter((p) => p.value > 0)
                  .map((p, i) => (
                    <div key={i} className="barrow-seg" style={{ width: pct(p.value), background: p.color }}>
                      <span className="bar-tip">
                        {p.label}: <strong>{Number.isInteger(p.value) ? p.value : p.value.toFixed(1)}</strong>
                      </span>
                    </div>
                  ))}
              </div>
              {reference !== undefined && <div className="barrow-ref" style={{ left: pct(reference) }} />}
            </div>
            <div className="barrow-value">{r.value}</div>
          </>
        );
        return r.onClick ? (
          <button key={r.key} className="barrow clickable" onClick={r.onClick} disabled={r.disabled} title={r.title}>
            {body}
          </button>
        ) : (
          <div key={r.key} className="barrow">
            {body}
          </div>
        );
      })}
      {reference !== undefined && referenceLabel && (
        <div className="barrow-reflegend muted small">
          <span className="barrow-refmark" /> {referenceLabel}
        </div>
      )}
    </div>
  );
}

/** A thin meter for one share (0..1), e.g. how big a leak is next to the biggest one. */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * value)} aria-label={label}>
      <div style={{ width: `${Math.max(3, Math.min(100, 100 * value))}%` }} />
    </div>
  );
}

/** Score color: poor, even or good, always shown next to the percentage itself. */
export const scoreColor = (pct: number) => (pct < 40 ? "var(--sev-3)" : pct >= 60 ? "var(--accent)" : "var(--draw)");
