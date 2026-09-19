import { useSyncExternalStore } from "react";

let hydrationReady = false;
let barrierStarted = false;
const listeners = new Set<() => void>();

const markHydrationReady = () => {
  const publish = () => {
    hydrationReady = true;
    listeners.forEach((listener) => listener());
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(publish);
  } else {
    window.setTimeout(publish, 0);
  }
};

const startHydrationBarrier = () => {
  if (barrierStarted || typeof window === "undefined") return;
  barrierStarted = true;
  if (document.readyState === "complete") {
    markHydrationReady();
  } else {
    window.addEventListener("load", markHydrationReady, { once: true });
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  startHydrationBarrier();
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => hydrationReady;
const getServerSnapshot = () => false;

/** Keep shared client state on its server value until the streamed document hydrates. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
