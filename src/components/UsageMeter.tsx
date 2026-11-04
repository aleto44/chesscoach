import { openUrl } from "../backend";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../coach/auth";
import { refreshUsage, useUsage, type UsageLimit } from "../coach/usage";

const USAGE_PAGE = "https://claude.ai/settings/usage";

/** Ring showing the 5-hour limit; click for the full breakdown. */
export function UsageMeter() {
  const { limits, loading, error } = useUsage();
  const plan = useAuth((s) => s.plan);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    refreshUsage();
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const primary = limits[0];
  const title = primary ? `${primary.label}: ${primary.percent}% used` : "Plan usage";

  return (
    <div className="usage" ref={root}>
      <button className="usage-ring-button" onClick={() => setOpen((o) => !o)} title={title} aria-label={title}>
        <Ring percent={primary?.percent ?? 0} spinning={!primary && loading} />
      </button>
      {open && (
        <div className="usage-popover" role="dialog">
          <header>
            <span className="muted">Plan usage limits{plan ? ` · ${plan}` : ""}</span>
            <span className="spacer" />
            <a href="#" onClick={(e) => (e.preventDefault(), openUrl(USAGE_PAGE))}>
              See all →
            </a>
          </header>
          {limits.map((l) => (
            <LimitRow key={l.label} limit={l} />
          ))}
          {!limits.length && <p className="muted small">{loading ? "Checking usage…" : error}</p>}
        </div>
      )}
    </div>
  );
}

function LimitRow({ limit }: { limit: UsageLimit }) {
  return (
    <div className="usage-row">
      <div className="usage-row-top">
        <span>{limit.label}</span>
        <span className="spacer" />
        {limit.resets && <span className="muted">Resets {limit.resets}</span>}
        <span className="usage-pct">{limit.percent}%</span>
      </div>
      <div className="usage-bar">
        <div className={`usage-fill ${level(limit.percent)}`} style={{ width: `${Math.min(100, limit.percent)}%` }} />
      </div>
    </div>
  );
}

function Ring({ percent, spinning }: { percent: number; spinning: boolean }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const shown = spinning ? 25 : Math.min(100, percent);
  return (
    <svg className={`usage-ring ${spinning ? "spinning" : ""}`} width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r={r} className="usage-ring-track" />
      <circle
        cx="10"
        cy="10"
        r={r}
        className={`usage-ring-fill ${level(percent)}`}
        strokeDasharray={`${(shown / 100) * c} ${c}`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function level(percent: number) {
  return percent >= 90 ? "critical" : percent >= 75 ? "warn" : "";
}
