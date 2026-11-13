// A trainer session kept in localStorage so a reload picks it up where the student left it: a phone
// drops the page when the student switches apps for a while.
import type { StoreApi, UseBoundStore } from "zustand";

/**
 * Restores the store's last saved value (when `valid` accepts it) through `resume`, and keeps saving
 * it from then on. Call once at startup.
 */
export function keepSession<T>(
  store: UseBoundStore<StoreApi<T | null>>,
  key: string,
  valid: (saved: T) => boolean,
  resume: (saved: T) => void,
) {
  let saved: T | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    saved = null;
  }
  store.subscribe((s) => {
    try {
      if (s) localStorage.setItem(key, JSON.stringify(s));
      else localStorage.removeItem(key);
    } catch {
      // Private mode or full storage: the session just won't survive a reload.
    }
  });
  if (saved && valid(saved)) resume(saved);
}
