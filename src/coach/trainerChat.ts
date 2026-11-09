// The coach's messages for a trainer on screen (the opening trainer's "why not"), shown in the chat
// column woven into the game's own chat in the order they came. Kept apart from the game's chat on purpose: trainers aren't
// games, so none of this is saved into a game's history (rated or not). It goes when the trainer closes.
import { create } from "zustand";
import { newId, useStore, type ChatItem } from "../store";

/** `after`: how many of the game's chat items there were when this came, so the two read in order. */
export type TrainerItem = ChatItem & { after: number };

export interface TrainerChat {
  items: TrainerItem[];
  /** The coach is working on an answer since then; null when it isn't. */
  thinkingSince: number | null;
}

export const useTrainerChat = create<TrainerChat>(() => ({ items: [], thinkingSince: null }));

/** Bumped on clear, so an answer for a trainer that has since closed is dropped. */
let generation = 0;
export const trainerGeneration = () => generation;

export function pushTrainer(item: { kind: "user" | "coach" | "system"; text: string }, gen = generation) {
  if (gen !== generation) return;
  const after = useStore.getState().chat.length;
  useTrainerChat.setState((s) => ({ items: [...s.items, { ...item, id: newId("c"), after } as TrainerItem] }));
}

export function trainerThinking(on: boolean, gen = generation) {
  if (gen !== generation) return;
  useTrainerChat.setState({ thinkingSince: on ? Date.now() : null });
}

export function clearTrainerChat() {
  generation++;
  useTrainerChat.setState({ items: [], thinkingSince: null }, true);
}

/** The trainer's last question and answer, for a follow-up asked in the chat. */
export function lastTrainerExchange(): string | null {
  const items = useTrainerChat.getState().items.filter((i) => i.kind === "user" || i.kind === "coach");
  let coach = items.length - 1;
  while (coach >= 0 && items[coach].kind !== "coach") coach--;
  if (coach < 0) return null;
  const q = items[coach - 1]?.kind === "user" ? items[coach - 1] : null;
  const text = (i: TrainerItem) => ("text" in i ? i.text : "");
  return `${q ? `Student asked: ${text(q)}
` : ""}Coach answered: ${text(items[coach])}`;
}
