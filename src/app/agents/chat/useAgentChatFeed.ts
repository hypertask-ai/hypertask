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

  // The queued-follow-up strip and the "is working" typing row sit in the
  // same scroll container as the feed (see the JSX below) but aren't part of
  // `visibleFeed`, so a queued send or the typing row appearing must count as
  // a feed change too or the list silently stops following (HTPR-6291).
  const extraRowsRevision = agentChatExtraRowsRevision({
    queuedMessageIds: queuedMessages.map((item) => item.id),
    queuedRowsVisible: activeFeedFilter !== "activity",
    typingRowVisible:
      awaiting &&
      activeFeedFilter !== "activity" &&
      !deliveryNotice &&
      !replyTimedOut,
  });

  // Jump to the bottom when the feed gains or replaces an item (own send,
  // poll, or realtime nudge), including when the capped feed stays the same
  // length. Filter changes still need a fresh overflow measurement.
  const prevFeedRevisionRef = useRef("");
  const prevExtraRowsRevisionRef = useRef("");
  // The first time a session's real content paints, force the landing to the
  // bottom no matter what showScrollToBottom says: the user cannot have
  // legitimately scrolled away from content that has never been on screen.
  // Without this, a reload that loads messages then activity back-to-back
  // could mis-measure scroll distance on the very first (still-empty) pass,
  // latch showScrollToBottom to true, and then stay stuck there forever --
  // every later update honors "user scrolled up" and skips the auto-scroll,
  // and the button never clears itself without a manual scroll.
  const initialScrollDoneRef = useRef(false);
  useLayoutEffect(() => {
    const changed =
      visibleFeedRevision !== prevFeedRevisionRef.current ||
      extraRowsRevision !== prevExtraRowsRevisionRef.current;
    prevFeedRevisionRef.current = visibleFeedRevision;
    prevExtraRowsRevisionRef.current = extraRowsRevision;
    const isFirstContent = !initialScrollDoneRef.current && visibleFeed.length > 0;
    // "auto" (instant), not "smooth": handleMessageListScroll below reads
    // scrollTop synchronously right after, and a smooth scroll hasn't moved
    // yet at that point, so it would misjudge distance-from-bottom.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFeedRevision, activeFeedFilter, extraRowsRevision]);
  useLayoutEffect(() => {
    // A different chat's feed identity has nothing to do with this one's;
    // don't let it suppress the next genuine feed update, and don't let it
    // borrow this new session's "have we shown its first content yet" state.
    prevFeedRevisionRef.current = "";
    prevExtraRowsRevisionRef.current = "";
    initialScrollDoneRef.current = false;
    scrollMessagesToBottom("auto");
    handleMessageListScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName]);

  awaitingRef.current = awaiting;
  // A failed delivery (deliveryNotice) leaves the ball with us: the composer
  // must reopen so the user can send again, and the poll must stay stopped.
  const composerLocked = awaiting && !deliveryNotice;

  return {
    activeFeedFilter, visibleFeed, scrollMessagesToBottom, handleMessageListScroll, composerLocked,
  };
}
