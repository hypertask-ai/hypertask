"use client";

import { useEffect } from "react";
import { AgentChatView } from "./AgentChatView";
import type { IProp } from "./agentChatTypes";
import { useAgentChatComposer } from "./useAgentChatComposer";
import { useAgentChatDetailsSheet } from "./useAgentChatDetailsSheet";
import { useAgentChatFeed } from "./useAgentChatFeed";
import { useAgentChatNavigation } from "./useAgentChatNavigation";
import { useAgentChatRoster } from "./useAgentChatRoster";
import { useAgentChatSend } from "./useAgentChatSend";
import { useAgentChatSession } from "./useAgentChatSession";
import { useAgentChatState } from "./useAgentChatState";
import { useAgentChatStream } from "./useAgentChatStream";
import { useAgentLifecycle } from "./useAgentLifecycle";

const AgentChatClient = (props: IProp) => {
  const agentChatState = useAgentChatState(props);
  const agentChatRoster = useAgentChatRoster({ ...agentChatState });
  const agentChatSession = useAgentChatSession({ ...agentChatState });
  const agentChatFeed = useAgentChatFeed({ ...agentChatState, ...agentChatSession });
  const { awaiting } = agentChatState;
  // Drain a queued follow-up once the ball is actually back in our court.
  // Runs after render, so it always sees the awaiting value this render
  // computed -- unlike draining synchronously inside loadMessages, which ran
  // before awaitingRef had been updated and left the queue stuck.
  useEffect(() => {
    if (!awaiting) drainQueuedMessageRef.current();
  }, [awaiting]);

  useAgentChatStream({ ...agentChatState, ...agentChatSession, ...agentChatRoster });
  const agentChatNavigation = useAgentChatNavigation({ ...agentChatState });
  const agentChatSend = useAgentChatSend({
    ...agentChatState,
    ...agentChatSession,
    ...agentChatFeed,
    ...agentChatNavigation,
    ...agentChatRoster,
  });
  const { drainQueuedMessageRef } = agentChatSend;
  const agentChatComposer = useAgentChatComposer({ ...agentChatState, ...agentChatRoster, ...agentChatSend });
  const agentLifecycle = useAgentLifecycle({
    ...agentChatNavigation,
    ...agentChatState,
    ...agentChatSession,
    ...agentChatRoster,
    ...agentChatSend,
    ...agentChatFeed,
  });
  const agentChatDetailsSheet = useAgentChatDetailsSheet({ ...agentChatState, ...agentChatNavigation });

  return (
    <AgentChatView
      {...agentChatState}
      {...agentChatRoster}
      {...agentChatSession}
      {...agentChatFeed}
      {...agentChatNavigation}
      {...agentChatSend}
      {...agentChatComposer}
      {...agentLifecycle}
      {...agentChatDetailsSheet}
    />
  );
};

export default AgentChatClient;
