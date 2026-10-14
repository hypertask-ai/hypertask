import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export const useHydrated = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
