// Plan usage limits, read from the CLI's `/usage` (src-tauri/src/auth.rs plan_usage).
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { hasBackend } from "../db";

export interface UsageLimit {
  label: string;
  percent: number;
  resets: string | null;
}

interface UsageState {
  limits: UsageLimit[];
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

export const useUsage = create<UsageState>(() => ({ limits: [], loading: false, error: null, updatedAt: null }));

const LABELS: Record<string, string> = {
  "Current session": "5-hour limit",
  "Current week (all models)": "Weekly · all models",
};

/** Parses lines like "Current session: 24% used · resets Nov 3, 10:19pm (America/New_York)". */
export function parseUsage(text: string): UsageLimit[] {
  const limits: UsageLimit[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(.+?):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/i);
    if (!m) continue;
    limits.push({
      label: LABELS[m[1]] ?? m[1].replace(/^Current week/, "Weekly"),
      percent: Number(m[2]),
      resets: m[3]?.replace(/\s*\([^)]*\)\s*$/, "") ?? null,
    });
  }
  return limits;
}

let inFlight: Promise<void> | null = null;

export function refreshUsage(): Promise<void> {
  if (!hasBackend()) return Promise.resolve();
  inFlight ??= (async () => {
    useUsage.setState({ loading: true });
    try {
      const limits = parseUsage(await invoke<string>("plan_usage"));
      useUsage.setState({ limits, error: limits.length ? null : "No usage limits reported", updatedAt: Date.now() });
    } catch (e) {
      useUsage.setState({ error: String(e) });
    } finally {
      useUsage.setState({ loading: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

let refreshTimer: number | undefined;
/** Coach turns use the plan, so refresh shortly after each one (coalescing bursts). */
export function refreshUsageSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshUsage, 1500);
}

export function initUsage() {
  if (!hasBackend()) return;
  refreshUsage();
  window.setInterval(refreshUsage, 5 * 60_000);
}
