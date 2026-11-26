// Hints about the position on the board right now. The surprise endings' written ideas speak from
// the start position; once the student has played on, a hint has to be about what's in front of
// them. Worked out from the position itself: what the opponent threatens (the engine's move if the
// student passed), loose pawns and pieces, passed pawns and whether a king can still catch them,
// and where the kings stand; then, on the next hint, the engine's move and what it does, in those
// same terms. Cards use the opening plans' format (openings/plans.ts) so they draw the same way.
import { Chess, type Move, type Square } from "chess.js";
import { getReviewEngine, type EngineLine } from "../engine/stockfish";
import type { PlanIdea } from "../openings/plans";
import type { Color } from "../store";

type Side = "w" | "b";
const NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const CENTRE = ["d4", "e4", "d5", "e5"] as Square[];

const fileOf = (sq: string) => sq.charCodeAt(0) - 97;
const rankOf = (sq: string) => Number(sq[1]) - 1;
/** King moves from a to b. */
const dist = (a: string, b: string) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
const other = (c: Side): Side => (c === "w" ? "b" : "w");
const sideName = (c: Side) => (c === "w" ? "White" : "Black");
/** "Nxb4" for White, "...Nxb4" for Black, as the rest of the app writes moves. */
const moveText = (m: Move) => (m.color === "b" ? `...${m.san}` : m.san);
const arrow = (b: string, m: { from: string; to: string }) => `${b}:${m.from}${m.to}`;

interface Unit {
  sq: Square;
  type: string;
  color: Side;
}

function units(chess: Chess): Unit[] {
  return chess
    .board()
    .flat()
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({ sq: x.square, type: x.type, color: x.color }));
}

const kingOf = (all: Unit[], c: Side) => all.find((u) => u.type === "k" && u.color === c)!.sq;

/** No enemy pawn ahead of it on its own or a neighbouring file. */
function isPassed(all: Unit[], p: Unit): boolean {
  const f = fileOf(p.sq);
  const r = rankOf(p.sq);
  return !all.some(
    (u) => u.type === "p" && u.color !== p.color && Math.abs(fileOf(u.sq) - f) <= 1 && (p.color === "w" ? rankOf(u.sq) > r : rankOf(u.sq) < r),
  );
}

/** Guarded by a pawn of its own side. */
const isProtected = (all: Unit[], p: Unit) =>
  all.some(
    (u) => u.type === "p" && u.color === p.color && Math.abs(fileOf(u.sq) - fileOf(p.sq)) === 1 && rankOf(u.sq) === rankOf(p.sq) + (p.color === "w" ? -1 : 1),
  );

/** Further out than every other pawn on the board, by at least a file. */
function isOutside(all: Unit[], p: Unit): boolean {
  const files = all.filter((u) => u.type === "p" && u.sq !== p.sq).map((u) => fileOf(u.sq));
  if (!files.length) return false;
  const f = fileOf(p.sq);
  return f < Math.min(...files) - 1 || f > Math.max(...files) + 1;
}

const queeningSquare = (p: Unit) => `${p.sq[0]}${p.color === "w" ? 8 : 1}` as Square;
/** Pawn moves to queen, counting the double step. */
function stepsToQueen(p: Unit): number {
  const n = p.color === "w" ? 7 - rankOf(p.sq) : rankOf(p.sq);
  const start = p.color === "w" ? rankOf(p.sq) === 1 : rankOf(p.sq) === 6;
  return start ? n - 1 : n;
}
/** The rule of the square, for the lone defending king (pure pawn endings only). */
function kingCatches(all: Unit[], p: Unit, toMove: Side): boolean {
  const king = kingOf(all, other(p.color));
  const d = dist(king, queeningSquare(p));
  const n = stepsToQueen(p);
  return toMove === p.color ? d <= n : d <= n + 1;
}

/** Units of `c` (not the king) attacked by the other side and not defended. */
function loose(chess: Chess, all: Unit[], c: Side): Unit[] {
  return all.filter((u) => u.color === c && u.type !== "k" && chess.isAttacked(u.sq, other(c)) && !chess.attackers(u.sq, c).length);
}

/** The squares a king could be heading for, most urgent first, each with how to say it. */
function kingTargets(all: Unit[], c: Side, toMove: Side): { sq: Square; say: string }[] {
  const pawnEnding = all.every((u) => u.type === "p" || u.type === "k");
  const out: { sq: Square; say: string }[] = [];
  for (const p of all.filter((u) => u.type === "p" && u.color !== c && isPassed(all, u)))
    if (!pawnEnding || !kingCatches(all, p, toMove) || dist(kingOf(all, c), queeningSquare(p)) <= 2)
      out.push({ sq: p.sq, say: `toward ${sideName(p.color)}'s passed pawn on ${p.sq}` });
  for (const p of all.filter((u) => u.type === "p" && u.color !== c && !isProtected(all, u)))
    out.push({ sq: p.sq, say: `toward the loose pawn on ${p.sq}` });
  for (const p of all.filter((u) => u.type === "p" && u.color === c && isPassed(all, u)))
    out.push({ sq: p.sq, say: `toward your passed pawn on ${p.sq}, to escort it` });
  out.push({ sq: CENTRE.reduce((a, b) => (dist(kingOf(all, c), a) <= dist(kingOf(all, c), b) ? a : b)), say: "toward the centre" });
  return out;
}

/** What a move does, in a few words: "takes the pawn on g6", "brings the king toward the b-pawn". */
function whatItDoes(fen: string, m: Move): string {
  const before = new Chess(fen);
  const all = units(before);
  const after = new Chess(m.after);
  const check = m.san.includes("+") ? ", with check" : "";
  if (m.promotion) return `promotes the pawn${check}`;
  if (m.captured) return `takes the ${NAME[m.captured]} on ${m.to}${check}`;
  if (m.piece === "p") {
    const pawn = all.find((u) => u.sq === m.from)!;
    if (isPassed(all, pawn)) return `pushes the passed pawn${check}`;
    if (isPassed(units(after), { ...pawn, sq: m.to })) return `makes a passed pawn${check}`;
    const hits = units(after).filter((u) => u.color !== m.color && u.type === "p" && after.attackers(u.sq, m.color).includes(m.to));
    if (hits.length) return `challenges the pawn on ${hits[0].sq}${check}`;
    return `gains space with the pawn${check}`;
  }
  if (m.piece === "k") {
    const toMove = other(m.color);
    const target = kingTargets(all, m.color, toMove).find((t) => dist(m.to, t.sq) < dist(m.from, t.sq));
    return target ? `brings the king ${target.say}${check}` : `repositions the king${check}`;
  }
  const piece = NAME[m.piece];
  const nowHits = units(after).filter((u) => u.color !== m.color && u.type !== "k" && after.attackers(u.sq, m.color).includes(m.to));
  if (nowHits.length) return `puts the ${piece} on ${m.to}, hitting the ${NAME[nowHits[0].type]} on ${nowHits[0].sq}${check}`;
  const saved = loose(before, all, m.color).filter((u) => after.attackers(u.sq, m.color).includes(m.to));
  if (saved.length) return `puts the ${piece} on ${m.to}, guarding the ${NAME[saved[0].type]} on ${saved[0].sq}${check}`;
  const passers = all.filter((u) => u.type === "p" && u.color !== m.color && isPassed(all, u));
  const blocked = passers.find((p) => m.to === `${p.sq[0]}${rankOf(p.sq) + 1 + (p.color === "w" ? 1 : -1)}`);
  if (blocked) return `blockades the passed pawn on ${blocked.sq}${check}`;
  return check ? `gives check with the ${piece}` : `improves the ${piece}`;
}

/** The engine's best move from `fen`, as a chess.js move. */
async function best(fen: string, depth: number): Promise<{ move: Move; line: EngineLine } | null> {
  const [line] = await getReviewEngine().analyze(fen, 1, depth);
  const uci = line?.pv[0];
  if (!uci) return null;
  try {
    return { move: new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }), line };
  } catch {
    return null;
  }
}

/** Student's view centipawns, mates as ±(10000 − distance). */
const cpFor = (l: EngineLine, c: Side) => (l.mate !== undefined ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : (l.cp ?? 0)) * (c === "w" ? 1 : -1);

/** "Right now": threats, loose pawns, passed pawns and the kings, for the student (`side`, to move). */
export async function situationCard(fen: string, side: Color): Promise<PlanIdea> {
  const me: Side = side === "white" ? "w" : "b";
  const them = other(me);
  const chess = new Chess(fen);
  const all = units(chess);
  const pawnEnding = all.every((u) => u.type === "p" || u.type === "k");
  const lines: string[] = [];
  const draw: string[] = [];
  const said = new Set<string>();

  // The threat: what the opponent would play if it were their move.
  if (!chess.inCheck()) {
    const parts = fen.split(" ");
    parts[1] = them;
    parts[3] = "-";
    try {
      const passed = parts.join(" ");
      new Chess(passed);
      const [threat, now] = await Promise.all([best(passed, 12), getReviewEngine().analyze(fen, 1, 12)]);
      if (threat) {
        const swing = now[0] ? cpFor(now[0], me) - cpFor(threat.line, me) : 0;
        const m = threat.move;
        if (m.captured || m.promotion || m.san.includes("#") || swing >= 150) {
          lines.push(`Watch out: ${sideName(them)} threatens ${moveText(m)}, which ${whatItDoes(passed, m)}.`);
          draw.push(arrow("r", m));
          if (m.captured) said.add(m.to);
        }
      }
    } catch {
      // A position that can't be passed in (the other king would be in check): no threat to name.
    }
  }

  for (const u of loose(chess, all, me).filter((x) => !said.has(x.sq))) {
    lines.push(`Your ${NAME[u.type]} on ${u.sq} is attacked and nothing guards it.`);
    draw.push(`r:${u.sq}`);
  }

  // Passed pawns, both sides, and whether the lone king can still catch them.
  for (const p of all.filter((u) => u.type === "p" && isPassed(all, u))) {
    const mine = p.color === me;
    const kinds = [isOutside(all, p) && "outside", isProtected(all, p) && "protected"].filter(Boolean).join(", ");
    let text = `${mine ? "Your" : `${sideName(p.color)}'s`} passed pawn on ${p.sq}${kinds ? ` (${kinds})` : ""}`;
    if (pawnEnding) {
      const caught = kingCatches(all, p, me);
      text += mine
        ? caught
          ? ": the enemy king is inside its square, so it needs your king's help or works as a decoy."
          : ": the enemy king is outside its square and can't catch it. Push it!"
        : caught
          ? ": your king is inside its square, so it can still catch it."
          : ": your king is outside its square and can't catch it alone!";
    } else text += mine ? ": it's your trump, keep it safe and push it when you can." : ": stop it before it gets going.";
    lines.push(text);
    draw.push(`${mine ? "g" : "r"}:${p.sq}${queeningSquare(p)}`);
  }

  // The kings: the more active one usually decides.
  const centre = (c: Side) => Math.min(...CENTRE.map((s) => dist(kingOf(all, c), s)));
  const gap = centre(me) - centre(them);
  if (gap >= 2) {
    lines.push(`Your king is ${gap} moves further from the centre than ${sideName(them)}'s: get it into play.`);
    draw.push(`y:${kingOf(all, me)}`);
  } else if (gap <= -2) {
    lines.push(`Your king is the more active one: use it before ${sideName(them)}'s catches up.`);
    draw.push(`g:${kingOf(all, me)}`);
  }

  if (!lines.length) lines.push("Nothing is attacked and no pawn is about to run. Look at the plan cards for what to aim for.");
  return { title: "Right now", text: lines.join(" "), draw: draw.join(" ") };
}

/** The engine's move and what it does. */
export async function moveCard(fen: string): Promise<PlanIdea | null> {
  const found = await best(fen, 16);
  if (!found) return null;
  const m = found.move;
  return { title: `The move: ${moveText(m)}`, text: `${moveText(m)} ${whatItDoes(fen, m)}.`, draw: arrow("g", m) };
}
