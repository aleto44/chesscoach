// Checks that spoken moves read as the moves they name: node scripts/check-voice.mjs
import { hearMove, pickMove, promotionPiece, sayMove, DEFAULT_CANCEL, DEFAULT_CONFIRM } from "../src/voice/parse.ts";

const words = { confirm: DEFAULT_CONFIRM, cancel: DEFAULT_CANCEL };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const TWO_KNIGHTS = "4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1";
const AFTER_E4_D5 = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
const CASTLES = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const PROMO = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
const BISHOPS = "4k3/8/8/8/8/8/1B6/4KB2 w - - 0 1";
const LONE_D = "4k3/8/8/8/3P4/8/8/4K3 w - - 0 1";

let bad = 0;
const uci = (m) => m.from + m.to + (m.promotion ?? "");
/** `want`: the one move (uci), a list of moves, "confirm"/"cancel"/"nothing"; `sure` checked when given. */
function hear(fen, text, want, sure, w = words) {
  const h = hearMove(fen, text, w);
  const got = h.kind === "move" ? h.moves.map(uci).sort().join(",") : h.kind;
  const expect = Array.isArray(want) ? [...want].sort().join(",") : want;
  const sureOk = sure === undefined || (h.kind === "move" && h.sure === sure);
  if (got !== expect || !sureOk) {
    console.error(`"${text}": got ${got}${h.kind === "move" ? ` sure=${h.sure}` : ""}, want ${expect}${sure === undefined ? "" : ` sure=${sure}`}`);
    bad++;
  }
  return h;
}
function pick(fen, text, said, want) {
  const h = hearMove(fen, said, words);
  const i = pickMove(fen, h.moves, text);
  const got = i === null ? "none" : uci(h.moves[i]);
  if (got !== want) console.error(`pick "${text}" after "${said}": got ${got}, want ${want}`), bad++;
}

// Pawn moves, said every way.
for (const t of ["d3", "d three", "pawn to d3", "play the pawn to d3", "pawn d three", "move a pawn to d3", "D 3"])
  hear(START, t, "d2d3", true);
hear(START, "d two d four", "d2d4", true);
hear(START, "e2e4", "e2e4", true);
hear(START, "delta four", "d2d4", true);
// Knights.
for (const t of ["knight f3", "knight to f three", "Nf3", "knight two f three", "night f3", "play knight to f3"])
  hear(START, t, "g1f3", true);
hear(START, "knight c3", "b1c3", true);
// Two knights on one square: both, until the student says which.
hear(TWO_KNIGHTS, "knight e4", ["c3e4", "g3e4"], false);
hear(TWO_KNIGHTS, "c knight to e4", "c3e4", true);
hear(TWO_KNIGHTS, "knight c e four", "c3e4", true);
hear(TWO_KNIGHTS, "knight from g3 to e4", "g3e4", true);
hear(TWO_KNIGHTS, "Nge4", "g3e4", true);
pick(TWO_KNIGHTS, "g", "knight e4", "g3e4");
pick(TWO_KNIGHTS, "the c knight", "knight e4", "c3e4");
pick(TWO_KNIGHTS, "from g three", "knight e4", "g3e4");
pick(TWO_KNIGHTS, "two", "knight e4", "g3e4");
pick(TWO_KNIGHTS, "first", "knight e4", "c3e4");
// Captures.
for (const t of ["pawn takes d5", "e takes d5", "takes d5", "exd5", "e takes d", "pawn takes"])
  hear(AFTER_E4_D5, t, "e4d5", true);
hear(AFTER_E4_D5, "queen takes d5", "nothing");
hear(START, "knight takes f3", "g1f3", false);
// Castling.
hear(CASTLES, "castles", ["e1g1", "e1c1"], false);
for (const t of ["castles king side", "castle kingside", "castles short", "O-O"]) hear(CASTLES, t, "e1g1", true);
for (const t of ["castles queen side", "castle long", "o-o-o"]) hear(CASTLES, t, "e1c1", true);
hear(CASTLES, "king g1", "e1g1", true);
pick(CASTLES, "king side", "castles", "e1g1");
pick(CASTLES, "queen side", "castles", "e1c1");
// Promotion.
for (const t of ["e8 queen", "e eight promote to queen", "promote queen", "pawn e8 equals queen", "e8=Q"]) hear(PROMO, t, "e7e8q", true);
hear(PROMO, "e8 promote to knight", "e7e8n", true);
// How the recognizer really hears "e eight promote to queen" (synthesized speech through Vosk).
hear(PROMO, "e a promote to queen", "e7e8q", true);
hear(PROMO, "e a queen", "e7e8q", true);
hear(START, "pawn two d three", "d2d3", true);
hear(TWO_KNIGHTS, "c knight two e four", "c3e4", true);
const p = hear(PROMO, "e8", "e7e8", true);
if (!p.needsPromotion) console.error('"e8" should ask for the piece'), bad++;
if (promotionPiece("knight") !== "n" || promotionPiece("make it a queen") !== "q") console.error("promotion piece"), bad++;
// Check as a tiebreak: both bishops reach e4... the b2 one gives no check, so "check" doesn't settle it here.
hear(BISHOPS, "bishop d3", "f1d3", true);
hear(BISHOPS, "bishop e5 check", "b2e5", true);
// Misheard letters: the position decides, and it's not sure.
hear(LONE_D, "b5", "d4d5", false);
hear(LONE_D, "e5", "d4d5", false);
// Commands.
for (const t of ["yes", "confirm", "Yes.", "yes please", "yes yes"]) hear(START, t, "confirm");
for (const t of ["no", "cancel"]) hear(START, t, "cancel");
hear(START, "play it", "confirm", undefined, { confirm: ["play it"], cancel: ["no"] });
hear(START, "hello there", "nothing");
hear(START, "knight", "nothing");
// Read back.
if (sayMove(START, { from: "g1", to: "f3", san: "Nf3" }) !== "Knight to f3") console.error("sayMove"), bad++;

console.log(`${bad} problems`);
process.exit(bad ? 1 : 0);
