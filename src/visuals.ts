// How boards look: square colors, piece set and coordinate size, picked in Settings → Visuals.
// Applied page-wide (CSS variables on <html> plus one <style> for the pieces), so every board,
// thumbnail and material strip follows without each Board knowing about it.
import { useSettings, type Settings } from "./settings";

export interface BoardColors {
  id: string;
  label: string;
  light: string;
  dark: string;
}

export const BOARD_COLORS: BoardColors[] = [
  { id: "brown", label: "Brown", light: "#f0d9b5", dark: "#b58863" },
  { id: "green", label: "Green", light: "#eeeed2", dark: "#769656" },
  { id: "blue", label: "Blue", light: "#dee3e6", dark: "#8ca2ad" },
  { id: "wood", label: "Wood", light: "#e9c9a0", dark: "#a8774a" },
  { id: "sea", label: "Sea", light: "#b1e4b9", dark: "#70a2a3" },
  { id: "purple", label: "Purple", light: "#e4dbef", dark: "#8877b7" },
  { id: "grey", label: "Grey", light: "#dadada", dark: "#a2a2a2" },
  { id: "tournament", label: "Tournament", light: "#ebece6", dark: "#3f7b5b" },
];

/**
 * Piece sets in public/pieces/<id>/ (wK.svg … bP.svg), from Lichess (github.com/lichess-org/lila,
 * public/piece; GPL, CC BY-SA and CC BY-NC-SA sets). cburnett is also bundled by chessground's CSS,
 * which stays the default so it needs no fetch.
 */
export const PIECE_SETS = [
  "cburnett", "merida", "alpha", "california", "cardinal", "chessnut", "companion", "fresca", "governor",
  "horsey", "kosal", "leipzig", "maestro", "pirouetti", "pixel", "staunty", "tatiana",
] as const;

export const COORD_SIZES = [
  { id: "off", label: "Off", scale: 0 },
  { id: "small", label: "Small", scale: 0.75 },
  { id: "medium", label: "Medium", scale: 1 },
  { id: "large", label: "Large", scale: 1.35 },
] as const;

export type CoordSize = (typeof COORD_SIZES)[number]["id"];

const PIECE_NAMES = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };

export function pieceUrl(set: string, color: "w" | "b", piece: keyof typeof PIECE_NAMES) {
  return `${import.meta.env.BASE_URL}pieces/${set}/${color}${piece}.svg`;
}

/** The square colors a setting stands for ("custom" = the two picked colors). */
export function boardColors(s: Pick<Settings, "boardColors" | "boardLight" | "boardDark">) {
  if (s.boardColors === "custom") return { light: s.boardLight, dark: s.boardDark };
  return BOARD_COLORS.find((b) => b.id === s.boardColors) ?? BOARD_COLORS[0];
}

function pieceCss(set: string) {
  if (set === "cburnett" || !PIECE_SETS.includes(set as never)) return "";
  const rules: string[] = [];
  for (const color of ["w", "b"] as const)
    for (const [letter, name] of Object.entries(PIECE_NAMES))
      rules.push(
        `.cg-wrap piece.${name}.${color === "w" ? "white" : "black"}{background-image:url("${pieceUrl(set, color, letter as never)}")}`,
      );
  return rules.join("\n");
}

/** Keeps the page's board look in step with the settings. */
export function initVisuals() {
  const style = document.createElement("style");
  style.id = "piece-set";
  document.head.appendChild(style);
  let shownSet = "";
  const apply = () => {
    const s = useSettings.getState();
    const root = document.documentElement.style;
    const { light, dark } = boardColors(s);
    root.setProperty("--sq-light", light);
    root.setProperty("--sq-dark", dark);
    const coords = COORD_SIZES.find((c) => c.id === s.coordSize) ?? COORD_SIZES[2];
    root.setProperty("--coord-scale", String(coords.scale || 1));
    document.documentElement.dataset.coords = coords.id;
    if (s.pieceSet !== shownSet) style.textContent = pieceCss((shownSet = s.pieceSet));
  };
  useSettings.subscribe(apply);
  apply();
}
