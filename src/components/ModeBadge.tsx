import { SITE_NAME, type GameMode, type ImportSite } from "../store";

export function ModeBadge({ mode }: { mode: GameMode }) {
  return (
    <span
      className={`mode-badge ${mode}`}
      title={
        mode === "rated"
          ? "Rated: no engine, coach or takebacks until the game ends. Counts toward your profile."
          : "Practice: engine, coach and takebacks allowed. Doesn't count toward your profile."
      }
    >
      {mode === "rated" ? "Rated" : "Practice"}
    </span>
  );
}

/** An imported game: where it was played. It counts like a rated game (real play, no help). */
export function SiteBadge({ site }: { site: ImportSite }) {
  return (
    <span className={`mode-badge site ${site}`} title={`Imported from ${SITE_NAME[site]}. Counts toward your profile like a rated game.`}>
      {SITE_NAME[site]}
    </span>
  );
}
