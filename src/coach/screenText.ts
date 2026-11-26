// What the student can read on screen outside the chat column: the trainer's status line, a hint
// they asked for, move notes, plan cards, a review's verdicts, menus, dialogs. The coach gets it with
// every question, so it sees what the student sees on any screen, including ones added later,
// without each one having to describe itself.
import type { DrawShape } from "chessground/draw";
import { boardsOnScreen } from "../components/Board";

/** Enough for a busy trainer screen; a long list (saved games) is cut. */
const MAX_CHARS = 3500;

/** Never read: the coach's own column and the top bar's buttons, and the board's coordinates and pieces. */
const SKIP = "aside.chat, .coach-tab, .phone-coach-tab, .chat-resize, header.topbar, cg-container, cg-board, coords, svg, script, style, template, [aria-hidden='true']";

const BLOCK = /^(block|flex|grid|list-item|table|table-row|flow-root)/;

function visible(el: Element): boolean {
  if (el.getClientRects().length) return true;
  // display: contents has no box of its own, but its children may.
  return getComputedStyle(el).display === "contents";
}

function walk(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent?.replace(/\s+/g, " ") ?? "";
    if (t.trim()) out.push(t);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.matches(SKIP) || !visible(node)) return;
  if (node instanceof HTMLSelectElement) {
    const label = node.selectedOptions[0]?.text;
    if (label) out.push(` [${label} ▾] `);
    return;
  }
  if (node instanceof HTMLInputElement) {
    if (node.type === "checkbox" || node.type === "radio") out.push(node.checked ? " [x] " : " [ ] ");
    else if (node.type !== "hidden" && node.type !== "password" && node.value) out.push(` [${node.value}] `);
    return;
  }
  if (node instanceof HTMLTextAreaElement) return;
  const block = BLOCK.test(getComputedStyle(node).display);
  const button = node instanceof HTMLButtonElement;
  if (block) out.push("\n");
  if (button) out.push(" [");
  for (const child of node.childNodes) walk(child, out);
  if (button) out.push("] ");
  if (block) out.push("\n");
}

/** The visible text of the app outside the chat, as lines; buttons in [brackets]. */
export function screenText(): string {
  const root = document.querySelector(".app");
  if (!root) return "";
  const out: string[] = [];
  for (const child of root.children) walk(child, out);
  // Dialogs may be portalled outside the app's root.
  for (const el of document.querySelectorAll("body > .modal-backdrop, body > .promo-backdrop")) walk(el, out);
  const text = out
    .join("")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/\[\s*\]/g, "").trim())
    .filter((l) => l && !/^\[[^\]]{0,2}\]$/.test(l))
    .filter((l, i, all) => l !== all[i - 1])
    .join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… (cut)` : text;
}

const shapeText = (s: DrawShape) => `${s.dest ? `${s.orig}-${s.dest} arrow` : `circle on ${s.orig}`}${s.brush ? ` (${s.brush})` : ""}`;

/** Arrows and circles on the boards on screen: the app's (hints, plans, the coach's) and the student's own. */
export function drawingLines(): string[] {
  const out: string[] = [];
  for (const b of boardsOnScreen()) {
    const app = b.app.filter((s) => !s.customSvg && !s.piece);
    if (app.length) out.push(`Drawn by the app on the board (${b.fen}): ${app.map(shapeText).join(", ")}`);
    if (b.student.length) out.push(`Drawn by the student on the board (${b.fen}): ${b.student.map(shapeText).join(", ")}`);
  }
  return out;
}
