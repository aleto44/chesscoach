// The coach's messages for a trainer on screen (the opening trainer's "why not"), shown in the chat
// column under the game's own chat. Kept apart from the game's chat on purpose: trainers aren't
// games, so none of this is saved into a game's history (rated or not). It goes when the trainer closes.
import { create } from "zustand";
import { newId, type ChatItem } from "../store";

export interface TrainerChat {
  items: ChatItem[];
  /** The coach is working on an answer since then; null when it isn't. */
  thinkingSince: number | null;
}

export const useTrainerChat = create<TrainerChat>(() => ({ items: [], thinkingSince: null }));

/** Bumped on clear, so an answer for a trainer that has since closed is dropped. */
let generation = 0;
export const trainerGeneration = () => generation;

export function pushTrainer(item: { kind: "user" | "coach" | "system"; text: string }, gen = generation) {
  if (gen !== generation) return;
  useTrainerChat.setState((s) => ({ items: [...s.items, { ...item, id: newId("c") } as ChatItem] }));
}

export function trainerThinking(on: boolean, gen = generation) {
  if (gen !== generation) return;
  useTrainerChat.setState({ thinkingSince: on ? Date.now() : null });
}

export function clearTrainerChat() {
  generation++;
  useTrainerChat.setState({ items: [], thinkingSince: null }, true);
}
