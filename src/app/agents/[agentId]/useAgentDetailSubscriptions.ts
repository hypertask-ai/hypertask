"use client";

import { invalidateSequencedResponse } from "@/lib/agents/responseSequence";
import { connectRealtimeClient, releaseRealtimeClientIfIdle, } from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import { useEffect, useRef } from "react";
import { POLL_MS } from "./agentDetailTypes";
import type { useAgentDetailRefresh } from "./useAgentDetailRefresh";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "renderedAgentIdentity"
  | "agentId"
  | "bootstrappedAgentId"
  | "latestResponseSeq"
  | "responseSeq"
  | "setActivity"
  | "setActivityError"
  | "setError"
  | "setAgent"
  | "agent"
> &
  Pick<
  ReturnType<typeof useAgentDetailRefresh>,
  | "fetchAgentRefresh"
  | "bootstrapAgent"
>;

export function useAgentDetailSubscriptions({
  renderedAgentIdentity, agentId, bootstrappedAgentId, latestResponseSeq, responseSeq, setActivity,
  setActivityError, setError, setAgent, fetchAgentRefresh, bootstrapAgent, agent,
}: Props) {
  useEffect(() => {
    let cancelled = false;
    const renderedAgent = renderedAgentIdentity.current;
    const changesAgent =
      !renderedAgent ||
      (renderedAgent.id !== agentId && renderedAgent.slug !== agentId);
    if (changesAgent) {
      bootstrappedAgentId.current = null;
      if (renderedAgent) {
        invalidateSequencedResponse(
          latestResponseSeq.current,
          ++responseSeq.current,
          [`activity:${renderedAgent.id}`],
        );
      }
      setActivity(null);
      setActivityError(null);
    }
    setError(null);
    setAgent((prev) =>
      prev && prev.id !== agentId && prev.slug !== agentId ? null : prev,
    );

    void fetchAgentRefresh({
      requestRef: agentId,
      mergeRuntime: false,
      cancelled: () => cancelled,
      reportError: true,
      onApplied: bootstrapAgent,
    });

    // Canonical runtime and membership fields are merged rather than replacing
    // the agent: a poll landing between an edit and its save would otherwise
    // throw the edit away.
    const poll = setInterval(() => {
      void fetchAgentRefresh({
        requestRef: agentId,
        mergeRuntime: true,
        cancelled: () => cancelled,
        onApplied: bootstrapAgent,
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [agentId, bootstrapAgent, fetchAgentRefresh]);

  // The poll above bounds staleness at 30s, but an assignment broadcasts a
  // board change event, so the assigned-ticket count can move the moment it
  // happens instead of on the next tick.
  const subscribedAgentId = agent?.id;
  const boardIdsKey = (agent?.boards ?? []).map((b) => b.id).join(",");
  const boardRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const boardIds = boardIdsKey
      ? boardIdsKey.split(",").map(Number).filter(Boolean)
      : [];
    if (boardIds.length === 0) return;
    let cancelled = false;
    let unsubs: Array<() => void> = [];

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      // Trailing debounce: bulk edits fire one event per ticket, so wait for
      // the burst to settle and fetch once. A failed fetch is left to the
      // poll above rather than retried into a loop.
      const scheduleRefresh = () => {
        if (boardRefreshTimer.current) clearTimeout(boardRefreshTimer.current);
        boardRefreshTimer.current = setTimeout(() => {
          boardRefreshTimer.current = null;
          void fetchAgentRefresh({
            requestRef: agentId,
            mergeRuntime: true,
            expectedAgentId: subscribedAgentId,
            cancelled: () => cancelled,
          });
        }, 500);
      };

      unsubs = boardIds.map((boardId) => {
        const channelName = boardChannel(boardId);
        const channel = client.subscribe(channelName);
        const onBoardEvent = () => scheduleRefresh();
        channel.bind(BOARD_EVENT, onBoardEvent);
        return () => {
          channel.unbind(BOARD_EVENT, onBoardEvent);
          client.unsubscribe(channelName);
        };
      });
      unsubs.push(() => releaseRealtimeClientIfIdle(client));
    })();

    return () => {
      cancelled = true;
      if (boardRefreshTimer.current) {
        clearTimeout(boardRefreshTimer.current);
        boardRefreshTimer.current = null;
      }
      unsubs.forEach((fn) => fn());
    };
  }, [boardIdsKey, agentId, subscribedAgentId, fetchAgentRefresh]);

}
