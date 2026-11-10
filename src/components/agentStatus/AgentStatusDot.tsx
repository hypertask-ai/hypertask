import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import type { AgentStatusDotMode } from "@/lib/agentStatus/dot";

const AgentStatusDot = ({ mode }: { mode: AgentStatusDotMode }) => (
  <span
    data-testid="agent-status-dot"
    className={cn(
      "status-dot h-[6px] w-[6px] shrink-0 rounded-full",
      mode === "working" && "bg-[#51A4F1] motion-safe:animate-pulse",
      mode === "waiting" && "bg-[#FB773F]",
    )}
  />
);

export default AgentStatusDot;
