import { useEffect, type CSSProperties } from "react";
import { BoardPanel } from "./components/BoardPanel";
import { Chat } from "./components/Chat";
import { ConfirmHost } from "./components/Confirm";
import { TopBar } from "./components/TopBar";
import { DrillPanel } from "./components/DrillPanel";
import { PuzzlePanel } from "./components/PuzzlePanel";
import { Home } from "./components/Home";
import { EndgamePanel } from "./components/Endgames";
import { OpeningPanel } from "./components/OpeningPanel";
import { openingStep, useOpening } from "./openings/session";
import { GuessPanel } from "./components/Guess";
import { PlanPanel } from "./components/Plans";
import { planStep, usePlan } from "./plans/session";
import { endgameStep, useEndgame } from "./endgames/session";
import { guessStep, useGuess } from "./guess/session";
import { back, peeking, useNav } from "./nav";
import { useSettings } from "./settings";
import { useTapAway } from "./chess/squareRefs";
import { usePuzzle, viewStep } from "./puzzles/session";
import { drillStep, useDrill } from "./analysis/drillSession";
import type { Step } from "./chess/view";
import { goto, openTangent, screen, step, useStore } from "./store";
import { AnalysisPanel } from "./components/Analysis";
import { analysisStep, closeAnalysis, useAnalysis } from "./analysis/layer";

export default function App() {
  // A square or move tapped in any text stays on the board until a tap elsewhere.
  useTapAway();
  const drilling = useDrill((d) => d !== null);
  const puzzling = usePuzzle((p) => p !== null);
  const endgame = useEndgame((e) => e !== null);
  const opening = useOpening((o) => o !== null);
  const guessing = useGuess((g) => g !== null);
  const planning = usePlan((p) => p !== null);
  const onBoard = useNav((n) => n.view === "board");
  // A coach scenario opened over a session shows on the main board; the session waits underneath.
  const peeked = useNav((n) => n.peek);
  const scenarioOpen = useStore((s) => !!s.active);
  const peek = peeked && scenarioOpen;
  // The analysis board sits one level above whatever opened it, which keeps its state underneath.
  const analyzing = useAnalysis((a) => a !== null);
  // Desktop coach column: its saved width, and 0 while it's tucked into the side tab (styles.css).
  const chatWidth = useSettings((s) => s.chatWidth);
  const chatCollapsed = useSettings((s) => s.chatCollapsed);
  const layout = { "--chat-open": `${chatWidth}px`, "--chat-w": chatCollapsed ? "0px" : `${chatWidth}px` } as CSSProperties;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select")) return;
      // An open dialog handles its own Escape.
      if (document.querySelector(".modal-backdrop, .promo-backdrop, .puzzle-settings-pop")) return;
      if (useAnalysis.getState()) {
        const keys: Record<string, Step> = { ArrowLeft: -1, ArrowRight: 1, Home: "start", End: "end" };
        if (e.key in keys) analysisStep(keys[e.key]);
        else if (e.key === "Escape") closeAnalysis();
        else return;
        e.preventDefault();
        return;
      }
      const session = peeking()
        ? null
        : usePuzzle.getState()
        ? viewStep
        : useDrill.getState()
          ? drillStep
          : useEndgame.getState()
            ? endgameStep
            : useOpening.getState()
              ? openingStep
            : useGuess.getState()
              ? guessStep
              : usePlan.getState()
                ? planStep
                : null;
      if (session) {
        // A puzzle or drill: the arrow keys step through its moves, Escape leaves it.
        const keys: Record<string, Step> = { ArrowLeft: -1, ArrowRight: 1, Home: "start", End: "end" };
        if (e.key in keys) session(keys[e.key]);
        else if (e.key === "Escape") back();
        else return;
        e.preventDefault();
        return;
      }
      if (useNav.getState().view !== "board" && !peeking()) {
        // A menu: Escape goes up a level; the arrow keys would move a board that isn't showing.
        if (e.key !== "Escape") return;
        back();
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
    <div className="app" style={layout}>
      <TopBar />
      {analyzing ? (
        <AnalysisPanel />
      ) : peek && (puzzling || drilling || endgame || opening || guessing || planning) ? (
        <BoardPanel />
      ) : puzzling ? (
        <PuzzlePanel />
      ) : drilling ? (
        <DrillPanel />
      ) : endgame ? (
        <EndgamePanel />
      ) : opening ? (
        <OpeningPanel />
      ) : guessing ? (
        <GuessPanel />
      ) : planning ? (
        <PlanPanel />
      ) : onBoard ? (
        <BoardPanel />
      ) : (
        <Home />
      )}
      <Chat />
      <ConfirmHost />
    </div>
  );
}
