"use client";

import { useEffect } from "react";
import { AgentChatPane } from "./AgentChatPane";
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
  useEffect(() => {
    if (!props.embedded?.active) return;
    if (!agentChatSession.sessionName) agentChatSession.selectAgent(props.embedded.agent);
    else void agentChatSession.loadMessages(agentChatSession.sessionName);
  }, [props.embedded?.agent.id, props.embedded?.active, props.embedded?.requestId]);
  useEffect(() => {
    if (!awaiting && (!props.embedded || props.embedded.active)) drainQueuedMessageRef.current();
  }, [awaiting, props.embedded?.active]);

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

  if (props.embedded) return (
    <AgentChatPane
      {...agentChatState}
      {...agentChatRoster}
      {...agentChatSession}
      {...agentChatFeed}
      {...agentChatNavigation}
      {...agentChatSend}
      {...agentChatComposer}
      {...agentLifecycle}
      embedded
      active={props.embedded.active}
    />
  );

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
