"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
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

const FeatureFlagsContext = createContext<Record<string, boolean>>({});
const FLAGS_ROUTE = "/api/flags";
const FLAGS_REFRESH_MS = 5_000;
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
}: {
  children: ReactNode;
  userId: number | null;
}) {
  const queryClient = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const query = useQuery({
    queryKey: featureFlagsQueryKey(userId ?? 0),
    queryFn: fetchFeatureFlags,
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

  return (
    <FeatureFlagsContext.Provider value={query.data ?? {}}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFlag(key: string): boolean {
  return useContext(FeatureFlagsContext)[key] === true;
}
