// Theme mastery as experience: each rated try earns XP in the puzzle's themes (more for harder
// puzzles, a little lost on a miss; puzzles.rs `xp_for`). XP buys stars, each a bit dearer than the
// last, and five stars move a theme up a tier. A miss can drain the bar but never takes a star.
import { useEffect, useState } from "react";
import { themeLabel, type ThemeGain, type ThemeLevel } from "../puzzles/puzzles";

export const STARS_PER_TIER = 5;
const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];

/** The tier a star count is in, and the stars collected toward the next one. */
export function tierOf(stars: number) {
  const index = Math.min(Math.floor(stars / STARS_PER_TIER), TIERS.length - 1);
  return { index, name: TIERS[index], inTier: stars - index * STARS_PER_TIER };
}

/** "Silver ★★☆☆☆"; Diamond, the last tier, just counts its stars. */
export function StarBadge({ stars, fresh }: { stars: number; fresh?: boolean }) {
  const tier = tierOf(stars);
  const last = tier.index === TIERS.length - 1;
  return (
    <span className={`star-badge tier-${tier.index}`} title={`${stars} star${stars === 1 ? "" : "s"} · ${tier.name}`}>
      <span className="tier-name">{tier.name}</span>
      {last ? (
        <span className="stars">★ {tier.inTier}</span>
      ) : (
        <span className="stars">
          {Array.from({ length: STARS_PER_TIER }, (_, i) => (
            <span key={i} className={`star${i < tier.inTier ? " on" : ""}${fresh && i === tier.inTier - 1 ? " fresh" : ""}`}>
              ★
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** XP toward the next star. `instant` skips the fill animation (a new star starting from empty). */
export function XpBar({ level, instant }: { level: ThemeLevel; instant?: boolean }) {
  const pct = Math.max(0, Math.min(100, (100 * (level.xp - level.start)) / (level.end - level.start)));
  return (
    <span className={`xp-bar${instant ? " instant" : ""}`} title={`${level.xp - level.start} of ${level.end - level.start} XP to the next star`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export const MasteryRule = () => (
  <p className="muted small mastery-rule">
    Each puzzle earns XP in its themes: more for harder ones, and a miss costs a little. Every star takes a bit more XP than the
    last, and {STARS_PER_TIER} stars move a theme up a tier.
  </p>
);

/**
 * On the puzzle screen: the puzzle's themes, the bar filling (or draining) by this try's XP. A new
 * star fills the bar to the end first, then starts the next one.
 */
export function MasteryGains({ gains }: { gains: ThemeGain[] }) {
  // 0: as it was; 1: moving (to full, if a star was earned); 2: the new star's bar, empty; 3: there.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    setPhase(0);
    const ids = [
      window.setTimeout(() => setPhase(1), 250),
      window.setTimeout(() => setPhase(2), 1050),
      window.setTimeout(() => setPhase(3), 1120),
    ];
    return () => ids.forEach(clearTimeout);
  }, [gains]);
  const ups = gains.filter((g) => g.after.stars > g.before.stars);
  return (
    <div className="mastery-gains">
      {phase >= 2 && ups.length > 0 && <Banner ups={ups} />}
      {gains.map((g) => {
        const up = g.after.stars > g.before.stars;
        const shown: ThemeLevel =
          phase === 0
            ? g.before
            : !up || phase === 3
              ? g.after
              : phase === 1
                ? { ...g.before, xp: g.before.end }
                : { ...g.after, xp: g.after.start };
        const d = g.after.xp - g.before.xp;
        return (
          <div key={g.theme} className="mastery-gain">
            {/* A card per theme: its name and stars, then its bar with this try's XP at the end. */}
            <div className="mastery-gain-head">
              <span className="mastery-name">{themeLabel(g.theme)}</span>
              <StarBadge stars={phase >= 2 ? g.after.stars : g.before.stars} fresh={up && phase >= 2} />
            </div>
            <div className="mastery-gain-bar">
              <XpBar level={shown} instant={phase === 2} />
              <span className={`xp-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`} style={{ visibility: phase >= 1 ? "visible" : "hidden" }}>
                {d > 0 ? `+${d}` : d} XP
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Banner({ ups }: { ups: ThemeGain[] }) {
  const tierUp = ups.find((g) => tierOf(g.after.stars).index > tierOf(g.before.stars).index);
  return (
    <div className={`mastered-banner${tierUp ? " tier" : ""}`}>
      {tierUp
        ? `${themeLabel(tierUp.theme)} reached ${tierOf(tierUp.after.stars).name}!`
        : `★ New star in ${ups.map((g) => themeLabel(g.theme)).join(" and ")}!`}
    </div>
  );
}
