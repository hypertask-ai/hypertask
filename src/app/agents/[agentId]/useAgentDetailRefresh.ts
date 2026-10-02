"use client";

import { invalidateSequencedResponse } from "@/lib/agents/responseSequence";
import { useCallback, useEffect } from "react";
import { TActivityItem, TDetailAgent } from "./agentDetailTypes";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "responseSeq"
  | "agentRouteRef"
  | "applyResponse"
  | "setError"
  | "setAgent"
  | "renderedAgentIdentity"
  | "applyError"
  | "latestResponseSeq"
  | "setActivity"
  | "setActivityError"
  | "router"
  | "bootstrappedAgentId"
  | "setNow"
  | "agent"
  | "setProviderKey"
  | "setProviderKeyLoaded"
>;

export function useAgentDetailRefresh({
  responseSeq, agentRouteRef, applyResponse, setError, setAgent, renderedAgentIdentity, applyError,
  latestResponseSeq, setActivity, setActivityError, router, bootstrappedAgentId, setNow, agent,
  setProviderKey, setProviderKeyLoaded,
}: Props) {
  const fetchAgentRefresh = useCallback(
    async ({
      requestRef,
      mergeRuntime,
      expectedAgentId,
      cancelled = () => false,
      reportError = false,
      onApplied,
    }: {
      requestRef: string;
      mergeRuntime: boolean;
      expectedAgentId?: string;
      cancelled?: () => boolean;
      reportError?: boolean;
      onApplied?: (refreshedAgent: TDetailAgent) => void;
    }) => {
      const seq = ++responseSeq.current;
      const responseKeys = [`agent:${requestRef}`];
      if (expectedAgentId) responseKeys.push(`agent:${expectedAgentId}`);
      try {
        const res = await fetch(`/api/agents/${requestRef}`);
        const data = (await res.json()) as {
          success?: boolean;
          agent?: TDetailAgent;
          error?: string;
        };
        if (!res.ok || !data.success || !data.agent) {
          throw new Error(data.error ?? "Failed to load agent");
        }
        if (cancelled()) return true;
        const refreshedAgent = data.agent;
        if (
          refreshedAgent.id !== requestRef &&
          refreshedAgent.slug !== requestRef
        ) {
          return false;
        }
        if (expectedAgentId && refreshedAgent.id !== expectedAgentId)
          return true;
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return true;
        }
        responseKeys.push(`agent:${refreshedAgent.id}`);
        if (refreshedAgent.slug) {
          responseKeys.push(`agent:${refreshedAgent.slug}`);
        }
        applyResponse(seq, responseKeys, () => {
          setError(null);
          setAgent((prev) => {
            if (prev && prev.id !== refreshedAgent.id) return prev;
            if (!mergeRuntime || !prev) return refreshedAgent;
            const {
              working,
              heartbeatAt,
              lastPostedAt,
              operations,
              boards,
              boardAccess,
            } = refreshedAgent;
            return {
              ...prev,
              working: working ?? null,
              heartbeatAt,
              lastPostedAt,
              operations,
              boards,
              boardAccess,
            };
          });
          onApplied?.(refreshedAgent);
        });
        return true;
      } catch (e) {
        if (cancelled()) return false;
        const identity = renderedAgentIdentity.current;
        const currentRoute = agentRouteRef.current;
        const requestIsCurrent =
          currentRoute === requestRef ||
          (identity != null &&
            (identity.id === currentRoute || identity.slug === currentRoute) &&
            (identity.id === requestRef || identity.slug === requestRef));
        if (reportError && requestIsCurrent) {
          applyError(seq, responseKeys, () => {
            setError(e instanceof Error ? e.message : "Failed to load agent");
          });
        }
        return false;
      }
    },
    [applyError, applyResponse],
  );

  const loadActivity = useCallback(
    async (refreshedAgent: TDetailAgent) => {
      const seq = ++responseSeq.current;
      const responseKey = `activity:${refreshedAgent.id}`;
      invalidateSequencedResponse(latestResponseSeq.current, seq, [
        responseKey,
      ]);
      try {
        const res = await fetch(
          `/api/agents/${refreshedAgent.id}/activity?limit=40`,
        );
        const data = (await res.json()) as {
          success?: boolean;
          items?: TActivityItem[];
          error?: string;
        };
        if (!res.ok || !data.success || !Array.isArray(data.items)) {
          throw new Error(data.error ?? "Failed to load activity");
        }
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return false;
        }
        return applyResponse(seq, [responseKey], () => {
          setActivity(data.items ?? []);
          setActivityError(null);
        });
      } catch (e) {
        const currentRoute = agentRouteRef.current;
        if (
          refreshedAgent.id !== currentRoute &&
          refreshedAgent.slug !== currentRoute
        ) {
          return false;
        }
        applyError(seq, [responseKey], () => {
          setActivityError(
            e instanceof Error ? e.message : "Failed to load activity",
          );
        });
        return false;
      }
    },
    [applyError, applyResponse],
  );

  const bootstrapAgent = useCallback(
    (refreshedAgent: TDetailAgent) => {
      if (
        refreshedAgent.slug &&
        refreshedAgent.slug !== agentRouteRef.current
      ) {
        router.replace(`/agents/${refreshedAgent.slug}`, { scroll: false });
      }
      if (bootstrappedAgentId.current === refreshedAgent.id) return;
      void loadActivity(refreshedAgent).then((loaded) => {
        if (loaded) bootstrappedAgentId.current = refreshedAgent.id;
      });
    },
    [loadActivity, router],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Native turns and an external agent's own Hyper AI calls both run on
  // Hypertask credentials, so every agent can carry a key of its own.
  const loadedAgentId = agent?.id;
  useEffect(() => {
    if (!loadedAgentId) return;
    let cancelled = false;
    setProviderKey(null);
    setProviderKeyLoaded(false);
    fetch(`/api/agents/${loadedAgentId}/provider-key`)
      .then((res) => res.json())
      .then(
        (data: {
          keys?: {
            provider: string;
            enabled?: boolean;
            maskedKey: string | null;
          }[];
        }) => {
        if (cancelled) return;
        // A disabled key resolves to the team credential, so the row has to
        // read "Team key" rather than show a key that is not in use.
        const row = data?.keys?.find(
          (k) => k.provider === "openrouter" && k.enabled !== false,
        );
        setProviderKey(row ?? null);
        setProviderKeyLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setProviderKeyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedAgentId]);


  return {
    fetchAgentRefresh, bootstrapAgent,
  };
}
