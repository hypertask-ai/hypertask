"use client";

import { useCallback, type ReactNode } from "react";
import {
  Provider as JotaiProvider,
  atom as jotaiAtom,
  useAtom,
  useAtomValue,
  useSetAtom,
  type Atom as JotaiAtom,
  type WritableAtom,
} from "jotai";
import { RESET } from "jotai/utils";

type SetStateAction<T> = T | ((prev: T) => T);
type ResettableAtom<T> = WritableAtom<T, [SetStateAction<T> | typeof RESET], void>;
export type SetterOrUpdater<T> = (valOrUpdater: SetStateAction<T>) => void;

type RecoilAtomOptions<T> = {
  key: string;
  default: T;
  effects_UNSTABLE?: unknown[];
};

type SelectorFamilyOptions<T, P> = {
  key: string;
  get: (param: P) => (helpers: { get: <Value>(atom: JotaiAtom<Value>) => Value }) => T;
};

type PersistAtomEffect = (() => void) & {
  __hypertaskPersistAtom: true;
};

const RECOIL_PERSIST_STORAGE_KEY = "recoil-persist";
const NO_VALUE = Symbol("NO_VALUE");
const PERSIST_WRITE_DEBOUNCE_MS = 200;

let persistedStateCache: Record<string, unknown> | null = null;
let persistWriteTimer: ReturnType<typeof setTimeout> | null = null;
let hasPendingPersistWrite = false;
let persistListenersRegistered = false;
const dirtyPersistKeys = new Set<string>();

const isBrowser = () => {
  if (typeof window === "undefined") return false;

  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
};

const parsePersistedState = (raw: string | null): Record<string, unknown> => {
  try {
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readPersistedStateFromStorage = (): Record<string, unknown> => {
  if (!isBrowser()) return {};

  try {
    return parsePersistedState(window.localStorage.getItem(RECOIL_PERSIST_STORAGE_KEY));
  } catch {
    return {};
  }
};

const writePersistedStateToStorage = (state: Record<string, unknown>) => {
  if (!isBrowser()) return;

  try {
    if (Object.keys(state).length === 0) {
      window.localStorage.removeItem(RECOIL_PERSIST_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(RECOIL_PERSIST_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage can throw in private contexts or when quota is exceeded.
  }
};

function applyExternalPersistedState(rawState: string | null) {
  const externalState = parsePersistedState(rawState);

  if (!persistedStateCache || dirtyPersistKeys.size === 0) {
    persistedStateCache = externalState;
    return;
  }

  const dirtyValues = new Map(
    Array.from(dirtyPersistKeys, (key) => [
      key,
      {
        hasValue: Object.prototype.hasOwnProperty.call(persistedStateCache, key),
        value: persistedStateCache![key],
      },
    ])
  );

  persistedStateCache = { ...externalState };

  dirtyValues.forEach(({ hasValue, value }, key) => {
    if (hasValue) persistedStateCache![key] = value;
    else delete persistedStateCache![key];
  });
}

function flushPersistedState() {
  if (!hasPendingPersistWrite) return;

  if (persistWriteTimer) {
    clearTimeout(persistWriteTimer);
    persistWriteTimer = null;
  }

  hasPendingPersistWrite = false;
  writePersistedStateToStorage(getPersistedStateCache());
  dirtyPersistKeys.clear();
}

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") flushPersistedState();
};

const handleStorageChange = (event: StorageEvent) => {
  if (event.key !== RECOIL_PERSIST_STORAGE_KEY && event.key !== null) return;

  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }

  applyExternalPersistedState(event.newValue);
};

function registerPersistListeners() {
  if (persistListenersRegistered || !isBrowser()) return;

  persistListenersRegistered = true;
  window.addEventListener("pagehide", flushPersistedState);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("storage", handleStorageChange);
}

function getPersistedStateCache() {
  if (!isBrowser()) return {};

  if (!persistedStateCache) {
    persistedStateCache = readPersistedStateFromStorage();
    registerPersistListeners();
  }

  return persistedStateCache;
}

const schedulePersistedStateWrite = () => {
  if (!isBrowser()) return;

  hasPendingPersistWrite = true;

  if (persistWriteTimer) clearTimeout(persistWriteTimer);
  persistWriteTimer = setTimeout(flushPersistedState, PERSIST_WRITE_DEBOUNCE_MS);
};

const readPersistedValue = <T,>(key: string, defaultValue: T): T => {
  const state = getPersistedStateCache();
  return Object.prototype.hasOwnProperty.call(state, key) ? (state[key] as T) : defaultValue;
};

const writePersistedValue = <T,>(key: string, value: T) => {
  const state = getPersistedStateCache();
  state[key] = value;
  dirtyPersistKeys.add(key);
  schedulePersistedStateWrite();
};

const removePersistedValue = (key: string) => {
  const state = getPersistedStateCache();
  delete state[key];
  dirtyPersistKeys.add(key);
  schedulePersistedStateWrite();
};

const isPersistAtomEffect = (effect: unknown): effect is PersistAtomEffect =>
  typeof effect === "function" && (effect as Partial<PersistAtomEffect>).__hypertaskPersistAtom === true;

const shouldPersist = (effects: unknown[] | undefined) =>
  Array.isArray(effects) && effects.some(isPersistAtomEffect);

export const recoilPersist = () => {
  const persistAtom = (() => undefined) as PersistAtomEffect;
  persistAtom.__hypertaskPersistAtom = true;
  return { persistAtom };
};

export function atom<T>(options: RecoilAtomOptions<T>): ResettableAtom<T> {
  const shouldPersistAtom = shouldPersist(options.effects_UNSTABLE);
  const initialValue = shouldPersistAtom
    ? readPersistedValue(options.key, options.default)
    : options.default;
  const baseAtom = jotaiAtom<T>(initialValue);

  const recoilShapedAtom = jotaiAtom(
    (get) => get(baseAtom),
    (get, set, update: SetStateAction<T> | typeof RESET) => {
      if (update === RESET) {
        set(baseAtom, options.default);
        if (shouldPersistAtom) removePersistedValue(options.key);
        return;
      }

      const nextValue =
        typeof update === "function" ? (update as (prev: T) => T)(get(baseAtom)) : update;

      set(baseAtom, nextValue);
      if (shouldPersistAtom) writePersistedValue(options.key, nextValue);
    }
  ) as ResettableAtom<T>;

  recoilShapedAtom.debugLabel = options.key;
  return recoilShapedAtom;
}

export function selectorFamily<T, P>(options: SelectorFamilyOptions<T, P>) {
  const cache = new Map<P, JotaiAtom<T>>();

  return (param: P) => {
    if (!cache.has(param)) {
      const derivedAtom = jotaiAtom((get) => options.get(param)({ get }));
      derivedAtom.debugLabel = `${options.key}__${String(param)}`;
      cache.set(param, derivedAtom);
    }

    return cache.get(param)!;
  };
}

export function useRecoilState<T>(
  recoilAtom: WritableAtom<T, [SetStateAction<T> | typeof RESET], void>
) {
  return useAtom(recoilAtom) as [T, SetterOrUpdater<T>];
}

export function useRecoilValue<T>(recoilAtom: JotaiAtom<T>) {
  return useAtomValue(recoilAtom);
}

export function useSetRecoilState<T>(
  recoilAtom: WritableAtom<T, [SetStateAction<T> | typeof RESET], void>
) {
  return useSetAtom(recoilAtom) as SetterOrUpdater<T>;
}

export const useResetRecoilState = <T,>(recoilAtom: ResettableAtom<T>) => {
  const setAtom = useSetAtom(recoilAtom);
  return useCallback(() => setAtom(RESET), [setAtom]);
};

export const StateRoot = ({ children }: { children: ReactNode }) => (
  <JotaiProvider>{children}</JotaiProvider>
);

export const RecoilRoot = StateRoot;
