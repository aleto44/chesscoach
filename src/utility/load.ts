// Utility › Load game: a position or a game brought in from outside (pasted text, a file, or a
// picture of a board read by the coach) and opened on the analysis board. Whatever the format, it
// ends up as a Line: a start position and the moves from it.
import { create } from "zustand";
import { Chess } from "chess.js";
import { buildLine, START_FEN, type Line } from "../chess/line";
import { parsePgn, splitPgn } from "../games/pgn";
import { invoke } from "../backend";

export interface Loaded {
  line: Line;
  /** What it was read as, for the screen ("FEN", "PGN", "Image"). */
  kind: string;
  title: string;
  /** The side at the bottom: an image says which; otherwise the side to move at the start. */
  orientation: "white" | "black";
}

export interface LoadState {
  text: string;
  loaded: Loaded | null;
  /** Several games in one PGN: the student picks one. */
  games: string[];
  error: string | null;
  reading: boolean;
  /** The picture being read (or last read), as a data URL, shown beside the board to compare. */
  image: string | null;
  /** The move the preview board is at; the analysis board opens there. */
  ply: number;
  /** Everything loaded before, newest first: kept on the computer, one list for every device. */
  history: HistoryEntry[];
  /** The history entry being shown, so fixes on the board are kept in it. */
  historyId: number | null;
}

/** One load (src-tauri/src/loads.rs), enough to show it again without reading the picture twice. */
export interface HistoryEntry {
  id: number;
  at: number;
  kind: string;
  title: string;
  startFen: string;
  sans: string[];
  orientation: "white" | "black";
  /** A small copy of the picture for the list; the full one comes when it's opened. */
  thumb: string | null;
  hasImage: boolean;
}

/** Kept outside the screen: the analysis board replaces it, and coming back should find it as it was. */
export const useLoad = create<LoadState>(() => ({
  text: "",
  loaded: null,
  games: [],
  error: null,
  reading: false,
  image: null,
  ply: 0,
  history: [],
  historyId: null,
}));
// A new game or position starts the preview at its first move; a game read from a picture starts at
// its last, the position the picture shows (its moves only came along because they lead there).
useLoad.subscribe((s, prev) => {
  if (s.loaded?.line === prev.loaded?.line) return;
  const ply = s.loaded?.kind === "Image" ? s.loaded.line.sans.length : 0;
  if (s.ply !== ply) useLoad.setState({ ply });
});

// --- the history: in the computer's database, never on the phone ---

// The list once lived in each device's localStorage.
try {
  localStorage.removeItem("cc-load-history");
} catch {
  /* no storage */
}

/** Fetches the list again, e.g. when the screen opens (the other device may have added to it). */
export async function refreshHistory() {
  try {
    useLoad.setState({ history: await invoke<HistoryEntry[]>("db_loads", {}) });
  } catch {
    /* the computer can't be reached: no history to show */
  }
}

/** Shows a load and records it in the history (the same game or position moves up). */
async function show(loaded: Loaded, image: string | null, thumb: string | null = null, error: string | null = null) {
  useLoad.setState({ loaded, image, games: [], error, historyId: null });
  try {
    const { line, kind, title, orientation } = loaded;
    const id = await invoke<number>("db_save_load", {
      load: { kind, title, startFen: line.startFen, sans: line.sans, orientation, thumb, image },
    });
    if (useLoad.getState().loaded === loaded) useLoad.setState({ historyId: id });
  } catch {
    /* not recorded; the load itself still shows */
  }
  await refreshHistory();
}

/** Keeps a fix made on the board (a misread square, the side to move, the orientation) in its entry. */
async function updateCurrent(loaded: Loaded) {
  const id = useLoad.getState().historyId;
  if (id == null) return;
  try {
    await invoke("db_update_load", { id, startFen: loaded.line.startFen, sans: loaded.line.sans, orientation: loaded.orientation });
  } catch {
    return;
  }
  await refreshHistory();
}

/** Opens an earlier load again, with its picture to compare against. */
export async function openHistory(id: number) {
  const e = useLoad.getState().history.find((h) => h.id === id);
  if (!e) return;
  const b = e.sans.length ? buildLine(e.startFen, e.sans) : null;
  const line = b && "line" in b ? b.line : positionLine(e.startFen);
  const loaded: Loaded = { line, kind: e.kind, title: e.title, orientation: e.orientation };
  const problem = e.kind === "Image" ? fenProblem(e.startFen) : null;
  useLoad.setState({
    loaded,
    image: e.thumb,
    games: [],
    error: problem ? `The reading needs fixing before it can be analyzed: ${problem}.` : null,
    historyId: id,
  });
  try {
    const image = await invoke<string | null>("db_open_load", { id });
    if (image && useLoad.getState().loaded === loaded) useLoad.setState({ image });
  } catch {
    /* the thumbnail stays */
  }
  await refreshHistory();
}

/** One entry, or every entry with no id. */
export async function removeHistory(id?: number) {
  const { historyId } = useLoad.getState();
  if (id === undefined || historyId === id) useLoad.setState({ historyId: null });
  useLoad.setState((s) => ({ history: id === undefined ? [] : s.history.filter((e) => e.id !== id) }));
  try {
    await invoke("db_remove_load", { id: id ?? null });
  } finally {
    await refreshHistory();
  }
}

export const setLoadPly = (ply: number) => useLoad.setState({ ply });

/** Ready for the analysis board: a position chess.js accepts. */
export function loadedLine(): Line | null {
  const l = useLoad.getState().loaded;
  return l && !fenProblem(l.line.startFen) ? l.line : null;
}

const PLACEMENT = /^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8}$/;

/** Castling rights the placement still allows: king and rook on their home squares. */
export function castlingFor(placement: string): string {
  const rows = placement.split("/");
  const at = (sq: string) => {
    const file = sq.charCodeAt(0) - 97;
    const row = rows[8 - Number(sq[1])];
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (f === file) return ch;
        f++;
      }
    }
    return null;
  };
  let out = "";
  if (at("e1") === "K") out += (at("h1") === "R" ? "K" : "") + (at("a1") === "R" ? "Q" : "");
  if (at("e8") === "k") out += (at("h8") === "r" ? "k" : "") + (at("a8") === "r" ? "q" : "");
  return out || "-";
}

/** A full FEN from a placement and the side to move, with the castling rights it can still have. */
export function fenFrom(placement: string, turn: "w" | "b"): string {
  return `${placement} ${turn} ${castlingFor(placement)} - 0 1`;
}

/** Why a FEN can't be analyzed, or null. chess.js checks the kings and the side not to move being in check. */
export function fenProblem(fen: string): string | null {
  try {
    new Chess(fen);
  } catch (e) {
    return (e as Error).message.replace(/^Invalid FEN: /, "");
  }
  const placement = fen.split(" ")[0];
  if (/[pP]/.test(placement.split("/")[0]) || /[pP]/.test(placement.split("/")[7])) return "a pawn is on the first or last rank";
  return null;
}

/** A FEN (full, EPD, or the placement alone), or null if the text isn't one. */
function readFen(text: string): string | null {
  const parts = text.trim().split(/\s+/);
  if (!PLACEMENT.test(parts[0])) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  if (parts.length >= 4 && /^(-|[KQkq]+)$/.test(parts[2]) && /^(-|[a-h][36])$/.test(parts[3])) {
    const half = /^\d+$/.test(parts[4] ?? "") ? parts[4] : "0";
    const full = /^\d+$/.test(parts[5] ?? "") ? parts[5] : "1";
    return `${parts[0]} ${turn} ${parts[2]} ${parts[3]} ${half} ${full}`;
  }
  return fenFrom(parts[0], turn);
}

/** Moves as UCI ("e2e4 e7e5 g1f3"), played from the start position. */
function readUci(text: string): Line | null {
  const moves = text.trim().split(/\s+/);
  if (!moves.every((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) return null;
  const c = new Chess();
  const sans: string[] = [];
  for (const u of moves) {
    try {
      sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      return null;
    }
  }
  const b = buildLine(START_FEN, sans);
  return "line" in b ? b.line : null;
}

/** A position with no moves. Not emptyLine: chess.js would reject an impossible one being fixed. */
const positionLine = (fen: string): Line => ({ startFen: fen, sans: [], fens: [fen], lastMoves: [], notes: [] });

const sideOf =(fen: string) => (fen.split(" ")[1] === "b" ? "black" : "white");

function pgnTitle(h: Record<string, string>): string {
  if (h.White || h.Black) {
    const year = h.Date?.match(/^\d{4}/)?.[0];
    return `${h.White ?? "?"} – ${h.Black ?? "?"}${h.Result && h.Result !== "*" ? ` ${h.Result}` : ""}${year ? ` (${year})` : ""}`;
  }
  return h.Event && h.Event !== "?" ? h.Event : "Pasted game";
}

/** One PGN game (or a bare move list, which reads the same way). */
function readPgnGame(pgn: string): Loaded {
  const p = parsePgn(pgn);
  return { line: p.line, kind: "PGN", title: pgnTitle(p.headers), orientation: sideOf(p.line.startFen) };
}

/**
 * Reads pasted or uploaded text: a FEN (or EPD), a PGN with one game or several, a move list in
 * SAN ("1.e4 e5 2.Nf3") or UCI ("e2e4 e7e5"). Throws with what went wrong.
 */
export function readText(raw: string): { loaded: Loaded } | { games: string[] } {
  const text = raw.trim();
  if (!text) throw new Error("Nothing to load.");
  const fen = readFen(text.split("\n")[0]);
  if (fen) {
    const problem = fenProblem(fen);
    if (problem) throw new Error(`That FEN can't be set up: ${problem}.`);
    return { loaded: { line: positionLine(fen), kind: "FEN", title: "Position from FEN", orientation: sideOf(fen) } };
  }
  const uci = readUci(text);
  if (uci) return { loaded: { line: uci, kind: "Moves", title: "Pasted moves", orientation: "white" } };
  const games = splitPgn(text);
  if (games.length > 1) return { games };
  try {
    const loaded = readPgnGame(text);
    if (!loaded.line.sans.length && loaded.line.startFen === START_FEN) throw new Error("No moves found.");
    return { loaded };
  } catch (e) {
    throw new Error(`Couldn't read that as a FEN, a PGN or a list of moves. ${(e as Error).message}`);
  }
}

// --- the store's actions ---

export function setLoadText(text: string) {
  useLoad.setState({ text });
}

export function loadText(text = useLoad.getState().text) {
  try {
    const r = readText(text);
    if ("games" in r) useLoad.setState({ games: r.games, loaded: null, error: null, image: null, historyId: null });
    else void show(r.loaded, null);
  } catch (e) {
    useLoad.setState({ error: (e as Error).message, loaded: null, games: [] });
  }
}

export function pickGame(i: number) {
  try {
    const games = useLoad.getState().games;
    void show(readPgnGame(games[i]), null);
    useLoad.setState({ games });
  } catch (e) {
    useLoad.setState({ error: (e as Error).message });
  }
}

/** The position after editing on the board (pieces, side to move): moves no longer apply. */
export function setPosition(fen: string) {
  const l = useLoad.getState().loaded;
  if (!l) return;
  const loaded = { ...l, line: positionLine(fen) };
  useLoad.setState({ loaded, error: null });
  void updateCurrent(loaded);
}

export function setOrientation(orientation: "white" | "black") {
  const l = useLoad.getState().loaded;
  if (!l) return;
  const loaded = { ...l, orientation };
  useLoad.setState({ loaded });
  void updateCurrent(loaded);
}

export const clearLoad = () => useLoad.setState({ text: "", loaded: null, games: [], error: null, image: null, ply: 0, historyId: null });

/** Text files load as text; images go to the coach to be read. */
export async function loadFile(file: File) {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return loadImage(file);
  const text = await file.text();
  useLoad.setState({ text });
  loadText(text);
}

/** Largest side sent to the coach: enough to read pieces, small enough for the phone's upload. */
const MAX_SIDE = 1400;

/** The copy in the history list. */
const THUMB_SIDE = 160;

/** The picture as a JPEG data URL, scaled down to fit `side`. */
async function shrink(file: Blob, side = MAX_SIDE, quality = 0.9): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't an image this browser can open."));
      i.src = url;
    });
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface BoardReading {
  placement?: string;
  bottom?: "white" | "black";
  toMove?: "w" | "b" | null;
  moves?: string[] | null;
  error?: string;
}

/**
 * A picture of a board: the coach's model reads it (coach_read_board). A move list it saw is used
 * when it replays to the same position; otherwise the position alone, which the student checks
 * against the picture and fixes on the board if a square was misread.
 */
export async function loadImage(file: Blob) {
  useLoad.setState({ reading: true, error: null, games: [] });
  try {
    const image = await shrink(file);
    useLoad.setState({ image, loaded: null, historyId: null });
    const thumb = await shrink(file, THUMB_SIDE, 0.7);
    const answer = await invoke<string>("coach_read_board", { image: image.split(",")[1], mediaType: "image/jpeg" });
    const json = answer.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("The coach didn't give a position.");
    const r = JSON.parse(json) as BoardReading;
    if (r.error) throw new Error(`No board found: ${r.error}`);
    const placement = r.placement?.trim().split(/\s+/)[0] ?? "";
    if (!PLACEMENT.test(placement)) throw new Error("The coach's reading wasn't a position.");
    const turn = r.toMove === "b" ? "b" : "w";
    const fen = fenFrom(placement, turn);
    const orientation = r.bottom === "black" ? "black" : "white";
    // The moves, if the picture had them and they lead to the board it shows.
    if (r.moves?.length) {
      const b = buildLine(START_FEN, r.moves);
      if ("line" in b && b.line.fens[b.line.fens.length - 1].split(" ")[0] === placement) {
        await show({ line: b.line, kind: "Image", title: "Game from a picture", orientation }, image, thumb);
        return;
      }
    }
    const problem = fenProblem(fen);
    // A misread can leave an impossible position: it still shows, to be fixed on the board.
    await show(
      { line: positionLine(fen), kind: "Image", title: "Position from a picture", orientation },
      image,
      thumb,
      problem ? `The reading needs fixing before it can be analyzed: ${problem}.` : null,
    );
  } catch (e) {
    useLoad.setState({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    useLoad.setState({ reading: false });
  }
}
