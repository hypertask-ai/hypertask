import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/** Keep hydration-sensitive client state on its server value until this component commits. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
