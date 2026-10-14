import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;
let minute = Math.floor(Date.now() / 60_000);

export function subscribeMinuteClock(listener: () => void): () => void {
  listeners.add(listener);
  if (interval === null) {
    interval = setInterval(() => {
      minute = Math.floor(Date.now() / 60_000);
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

const getMinute = () => minute;

export function useMinuteClock(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeMinuteClock : noopSubscribe,
    getMinute,
    getMinute,
  );
}

const noopSubscribe = () => () => {};
