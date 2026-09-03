"use client";

import {
  createContext,
  useContext,
  useEffect,
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
export const featureFlagsQueryKey = (userId: number) => ["feature-flags", userId] as const;

async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  const response = await fetch("/api/flags", { cache: "no-store" });
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
  const query = useQuery({
    queryKey: featureFlagsQueryKey(userId ?? 0),
    queryFn: fetchFeatureFlags,
    enabled: userId != null,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: featureFlagsQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }
      const channelName = featureFlagsChannel();
      const channel = client.subscribe(channelName);
      channel.bind(FEATURE_FLAGS_EVENT, refresh);
      client.connection.bind("connected", refresh);
      unsubscribe = () => {
        channel.unbind(FEATURE_FLAGS_EVENT, refresh);
        client.connection.unbind("connected", refresh);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

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
