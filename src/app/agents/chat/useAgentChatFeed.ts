"use client";

import { agentChatExtraRowsRevision, displayAgentChatFeed, mergeAgentChatFeed, shouldAutoScrollToBottom } from "@/lib/agents/chatActivityFeed";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "messages"
  | "activityRowsEnabled"
  | "activity"
  | "feedFilter"
  | "messageListRef"
  | "setShowScrollToBottom"
  | "queuedMessages"
  | "awaiting"
  | "deliveryNotice"
  | "replyTimedOut"
  | "showScrollToBottom"
  | "awaitingRef"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "sessionName"
>;

export function useAgentChatFeed({
  messages, activityRowsEnabled, activity, feedFilter, messageListRef, setShowScrollToBottom,
  queuedMessages, awaiting, deliveryNotice, replyTimedOut,
  showScrollToBottom, sessionName, awaitingRef,
}: Props) {
  const feed = useMemo(
    () =>
      mergeAgentChatFeed(
        messages ?? [],
        activityRowsEnabled ? activity : [],
      ),
    [messages, activity, activityRowsEnabled],
  );
  const activeFeedFilter = activityRowsEnabled ? feedFilter : "all";
  const visibleFeed = useMemo(
    () => displayAgentChatFeed(feed, activeFeedFilter),
    [feed, activeFeedFilter],
  );
  const visibleFeedRevision = useMemo(
    () =>
      JSON.stringify(
        visibleFeed.map((item) =>
          item.kind === "message"
            ? [item.kind, item.id]
            : [item.kind, ...item.events.map((event) => event.id)],
        ),
      ),
    [visibleFeed],
  );

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const target = messageListRef.current;
      if (!target) return;
      target.scrollTo({ top: target.scrollHeight, behavior });
    },
    [],
  );

  const handleMessageListScroll = useCallback(() => {
    const target = messageListRef.current;
    if (!target) {
      setShowScrollToBottom(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = target;
    setShowScrollToBottom(scrollTop + clientHeight < scrollHeight - 4);
  }, []);

  const extraRowsRevision = agentChatExtraRowsRevision({
    queuedMessageIds: queuedMessages.map((item) => item.id),
    queuedRowsVisible: activeFeedFilter !== "activity",
    typingRowVisible:
      awaiting &&
      activeFeedFilter !== "activity" &&
      !deliveryNotice &&
      !replyTimedOut,
  });

  const prevFeedRevisionRef = useRef("");
  const prevExtraRowsRevisionRef = useRef("");
  const initialScrollDoneRef = useRef(false);
  useLayoutEffect(() => {
    const changed =
      visibleFeedRevision !== prevFeedRevisionRef.current ||
      extraRowsRevision !== prevExtraRowsRevisionRef.current;
    prevFeedRevisionRef.current = visibleFeedRevision;
    prevExtraRowsRevisionRef.current = extraRowsRevision;
    const isFirstContent = !initialScrollDoneRef.current && visibleFeed.length > 0;
    if (
      shouldAutoScrollToBottom({
        feedChanged: changed,
        isFirstContent,
        userScrolledAway: showScrollToBottom,
      })
    ) {
      scrollMessagesToBottom("auto");
    }
    if (visibleFeed.length > 0) initialScrollDoneRef.current = true;
    handleMessageListScroll();

  }, [visibleFeedRevision, activeFeedFilter, extraRowsRevision]);
  useLayoutEffect(() => {
    prevFeedRevisionRef.current = "";
    prevExtraRowsRevisionRef.current = "";
    initialScrollDoneRef.current = false;
    scrollMessagesToBottom("auto");
    handleMessageListScroll();

  }, [sessionName]);

  awaitingRef.current = awaiting;
  const composerLocked = awaiting && !deliveryNotice;

  return {
    activeFeedFilter, visibleFeed, scrollMessagesToBottom, handleMessageListScroll, composerLocked,
  };
}
