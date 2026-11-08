import type { ServerEvent } from "@gunes/shared";

export type { ServerEvent };

type Listener = (event: ServerEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set();
  set.add(listener);
  listeners.set(userId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(userId);
  };
}

export function publish(userId: string, event: ServerEvent) {
  for (const listener of listeners.get(userId) ?? []) listener(event);
}
