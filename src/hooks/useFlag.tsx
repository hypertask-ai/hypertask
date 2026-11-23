"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import {
  FEATURE_FLAGS_EVENT,
  featureFlagsChannel,
} from "@/lib/realtime/shared";
import { useHydrated } from "@/hooks/General/useHydrated";

import type { FirstScreenFlags } from "@/lib/firstScreen/contract";

type FlagContext = { values: Record<string, boolean>; seeded: boolean; fallback: boolean };
type FlagReader = "value" | "loaded" | "ready";
const FeatureFlagsContext = createContext<FlagContext>({ values: {}, seeded: false, fallback: true });

function createFlagStore(initial: FlagContext) {
  let context = initial;
  const listeners = new Map<string, Set<() => void>>();
  const read = (key: string, reader: FlagReader, server = false) => {
    if (reader === "ready") return Object.hasOwn(context.values, key) || context.fallback;
    if (server && !context.seeded) return false;
    return reader === "value" ? context.values[key] === true : Object.hasOwn(context.values, key);
  };
  return {
    read,
    subscribe(key: string, listener: () => void) {
      const subscribers = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, subscribers);
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(key);
      };
    },
    publish(next: FlagContext) {
      const previous = context;
      const keys = Object.keys(next.values);
      const equal = keys.length === Object.keys(previous.values).length &&
        keys.every(key => Object.hasOwn(previous.values, key) && previous.values[key] === next.values[key]);
      context = { ...next, values: equal ? previous.values : next.values };
      for (const [key, subscribers] of listeners) {
        if (previous.values[key] !== context.values[key] ||
            Object.hasOwn(previous.values, key) !== Object.hasOwn(context.values, key) ||
            previous.fallback !== context.fallback || previous.seeded !== context.seeded) {
          for (const listener of subscribers) listener();
        }
      }
    },
  };
}

const FlagStoreContext = createContext<ReturnType<typeof createFlagStore> | null>(null);
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getHydratingSnapshot = () => false;

function FlagStoreProvider({ context, children }: { context: FlagContext; children: ReactNode }) {
  const [store] = useState(() => createFlagStore(context));
  useLayoutEffect(() => store.publish(context), [store, context]);
  return <FlagStoreContext.Provider value={store}>{children}</FlagStoreContext.Provider>;
}

function useFlagSnapshot(key: string, reader: FlagReader) {
  const store = useContext(FlagStoreContext);
  const subscription = useMemo(() => store ? {
    subscribe: (listener: () => void) => store.subscribe(key, listener),
    getSnapshot: () => store.read(key, reader),
    getServerSnapshot: () => store.read(key, reader, true),
  } : {
    subscribe: subscribeToHydration,
    getSnapshot: getHydratedSnapshot,
    getServerSnapshot: reader === "ready" ? getHydratedSnapshot : getHydratingSnapshot,
  }, [store, key, reader]);
  const value = useSyncExternalStore(subscription.subscribe, subscription.getSnapshot, subscription.getServerSnapshot);
  return { subscribed: store !== null, value };
}
const FLAGS_ROUTE = "/api/flags";
const FLAGS_REFRESH_MS = 60_000;
export const FEATURE_FLAGS_QUERY_PREFIX = ["feature-flags"] as const;
export const ADMIN_FEATURE_FLAGS_QUERY_KEY = ["admin-feature-flags"] as const;
export const featureFlagsQueryKey = (userId: number) => [...FEATURE_FLAGS_QUERY_PREFIX, userId] as const;

async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  const response = await fetch(FLAGS_ROUTE, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load feature flags");
  const body = (await response.json()) as { flags?: Record<string, boolean> };
  return body.flags ?? {};
}

export function FeatureFlagProvider({
  children,
  userId,
  initialFlags,
  subscribeByKey = false,
}: {
  children: ReactNode;
  userId: number | null;
  initialFlags?: FirstScreenFlags;
  subscribeByKey?: boolean;
}) {
  const queryClient = useQueryClient();
  const [initialSeed] = useState(() => {
    const key = featureFlagsQueryKey(userId ?? 0), updatedAt = Date.parse(initialFlags?.evaluatedAt ?? "");
    if (userId === null || initialFlags?.accountId !== userId || !Number.isFinite(updatedAt)) return undefined;
    if ((queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) <= updatedAt) {
      queryClient.setQueryData<Record<string, boolean>>(key, (current) => ({ ...current, ...initialFlags.values }), { updatedAt });
    }
    return initialFlags;
  });
  const seed = initialSeed?.accountId === userId ? initialSeed : undefined;
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const query = useQuery({
    queryKey: featureFlagsQueryKey(userId ?? 0),
    queryFn: fetchFeatureFlags,
    initialData: seed?.values,
    initialDataUpdatedAt: seed ? Date.parse(seed.evaluatedAt) : undefined,
    enabled: userId !== null,
    refetchInterval: realtimeConnected ? false : FLAGS_REFRESH_MS,
    refetchIntervalInBackground: !realtimeConnected,
    retry: false,
  });

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setRealtimeConnected(false);
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: featureFlagsQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ADMIN_FEATURE_FLAGS_QUERY_KEY });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (cancelled) {
        if (client) releaseRealtimeClientIfIdle(client);
        return;
      }
      if (!client) {
        setRealtimeConnected(false);
        return;
      }
      const channelName = featureFlagsChannel();
      const channel = client.subscribe(channelName);
      const realtimeUp = () => setRealtimeConnected(true);
      const realtimeDown = () => setRealtimeConnected(false);
      unsubscribe = () => {
        channel.unbind(FEATURE_FLAGS_EVENT, refresh);
        channel.unbind("pusher:subscription_succeeded", realtimeUp);
        channel.unbind("pusher:subscription_error", realtimeDown);
        client.connection.unbind("connected", refresh);
        client.connection.unbind("disconnected", realtimeDown);
        client.connection.unbind("unavailable", realtimeDown);
        client.connection.unbind("failed", realtimeDown);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
      channel.bind(FEATURE_FLAGS_EVENT, refresh);
      channel.bind("pusher:subscription_succeeded", realtimeUp);
      channel.bind("pusher:subscription_error", realtimeDown);
      client.connection.bind("connected", refresh);
      client.connection.bind("disconnected", realtimeDown);
      client.connection.bind("unavailable", realtimeDown);
      client.connection.bind("failed", realtimeDown);
      if (channel.subscribed) realtimeUp();
    })().catch((error) => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (!cancelled) setRealtimeConnected(false);
      console.warn("[feature-flags] realtime setup failed", error);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, userId]);

  const hydrated = useHydrated();
  const values = hydrated ? (query.data ?? seed?.values ?? {}) : (seed?.values ?? {});
  const context = useMemo(() => ({ values, seeded: seed !== undefined, fallback: query.isError }), [values, seed, query.isError]);
  if (subscribeByKey) return <FlagStoreProvider key={userId} context={context}>{children}</FlagStoreProvider>;
  return (
    <FeatureFlagsContext.Provider value={context}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function SubscribedFeatureFlagProvider(props: Omit<Parameters<typeof FeatureFlagProvider>[0], "subscribeByKey">) {
  return <FeatureFlagProvider {...props} subscribeByKey />;
}

export function useFlag(key: string): boolean {
  const { values, seeded } = useContext(FeatureFlagsContext);
  const { subscribed, value: hydrated } = useFlagSnapshot(key, "value");
  if (subscribed) return hydrated;
  return (seeded || hydrated) && values[key] === true;
}

export function useFlagLoaded(key: string): boolean {
  const { values, seeded } = useContext(FeatureFlagsContext);
  const { subscribed, value: hydrated } = useFlagSnapshot(key, "loaded");
  if (subscribed) return hydrated;
  return (seeded || hydrated) && Object.hasOwn(values, key);
}

export function useFlagReady(key: string): boolean {
  const { values, fallback } = useContext(FeatureFlagsContext);
  const { subscribed, value } = useFlagSnapshot(key, "ready");
  if (subscribed) return value;
  return Object.hasOwn(values, key) || fallback;
}
