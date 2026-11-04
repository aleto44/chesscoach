import { useEffect } from "react";
import { BoardPanel } from "./components/BoardPanel";
import { Chat } from "./components/Chat";
import { DrillPanel } from "./components/DrillPanel";
import { useDrill } from "./analysis/drillSession";
import { goto, openTangent, screen, step, useStore } from "./store";

export default function App() {
  const drilling = useDrill((d) => d !== null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input")) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") goto(0);
      else if (e.key === "End") goto(screen().line.sans.length);
      else if (e.key === "Escape") {
        // Pop one level of the tangent stack.
        const { active, tangents } = useStore.getState();
        if (active) openTangent(tangents[active].parentId);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      {drilling ? <DrillPanel /> : <BoardPanel />}
      <Chat />
    </div>
  );
}
