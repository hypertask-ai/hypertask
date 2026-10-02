"use client";

import { AgentDetailView } from "./AgentDetailView";
import type { IProp } from "./agentDetailTypes";
import { useAgentBoardAccess } from "./useAgentBoardAccess";
import { useAgentConfig } from "./useAgentConfig";
import { useAgentDetailLifecycle } from "./useAgentDetailLifecycle";
import { useAgentDetailRefresh } from "./useAgentDetailRefresh";
import { useAgentDetailState } from "./useAgentDetailState";
import { useAgentDetailSubscriptions } from "./useAgentDetailSubscriptions";
import { useAgentProviderKey } from "./useAgentProviderKey";

const AgentDetail = (props: IProp) => {
  const agentDetailState = useAgentDetailState(props);
  const agentDetailRefresh = useAgentDetailRefresh({ ...agentDetailState });
  useAgentDetailSubscriptions({ ...agentDetailState, ...agentDetailRefresh });
  const agentProviderKey = useAgentProviderKey({ ...agentDetailState });
  const agentDetailLifecycle = useAgentDetailLifecycle({ ...agentDetailState });
  const agentConfig = useAgentConfig({ ...agentDetailState, ...agentProviderKey });
  const agentBoardAccess = useAgentBoardAccess({ ...agentDetailState, ...agentDetailRefresh, ...agentProviderKey });

  return (
    <AgentDetailView
      {...agentDetailState}
      {...agentDetailRefresh}
      {...agentProviderKey}
      {...agentDetailLifecycle}
      {...agentConfig}
      {...agentBoardAccess}
    />
  );
};

export default AgentDetail;
