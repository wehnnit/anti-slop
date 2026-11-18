import type { RunEvent } from '../types.js';

type Listener = (ev: RunEvent) => void;

const listeners = new Set<Listener>();

export function publish(ev: RunEvent): void {
  for (const listener of listeners) {
    try {
      listener(ev);
    } catch {
      /* a dead stream must not break the publisher */
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listenerCount(): number {
  return listeners.size;
}
