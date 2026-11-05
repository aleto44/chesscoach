import { useEffect } from "react";
import { BoardPanel } from "./components/BoardPanel";
import { Chat } from "./components/Chat";
import { ConfirmHost } from "./components/Confirm";
import { TopBar } from "./components/TopBar";
import { DrillPanel } from "./components/DrillPanel";
import { PuzzlePanel } from "./components/PuzzlePanel";
import { Home } from "./components/Home";
import { back, useNav } from "./nav";
import { usePuzzle, viewStep } from "./puzzles/session";
import { useDrill } from "./analysis/drillSession";
import { goto, openTangent, screen, step, useStore } from "./store";

export default function App() {
  const drilling = useDrill((d) => d !== null);
  const puzzling = usePuzzle((p) => p !== null);
  const onBoard = useNav((n) => n.view === "board");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select")) return;
      // An open dialog handles its own Escape.
      if (document.querySelector(".modal-backdrop, .promo-backdrop")) return;
      if (useDrill.getState() || (!usePuzzle.getState() && useNav.getState().view !== "board")) {
        // A menu or a drill: Escape goes up a level; the arrow keys would move a board that isn't showing.
        if (e.key !== "Escape") return;
        back();
        e.preventDefault();
        return;
      }
      if (usePuzzle.getState()) {
        // The puzzle board: step through the solution once it's over.
        const keys: Record<string, Parameters<typeof viewStep>[0]> = { ArrowLeft: -1, ArrowRight: 1, Home: "start", End: "end" };
        if (!(e.key in keys)) return;
        viewStep(keys[e.key]);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") goto(0);
      else if (e.key === "End") goto(screen().line.sans.length);
      else if (e.key === "Escape") {
        // Pop one level of the tangent stack; from the game itself, back to the menu.
        const { active, tangents } = useStore.getState();
        if (active) openTangent(tangents[active].parentId);
        else back();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      {puzzling ? <PuzzlePanel /> : drilling ? <DrillPanel /> : onBoard ? <BoardPanel /> : <Home />}
      <Chat />
      <ConfirmHost />
    </div>
  );
}
