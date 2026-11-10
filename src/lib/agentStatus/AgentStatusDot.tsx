import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import type { AgentStatusDotMode } from "@/lib/agentStatus/dot";

const AgentStatusDot = ({ mode }: { mode: AgentStatusDotMode }) => (
  <span
    data-testid="agent-status-dot"
    className={cn(
      "h-[6px] w-[6px] shrink-0 rounded-full",
      mode === "working" && "bg-[var(--agent-status-dot-working)] motion-safe:animate-pulse",
      mode === "waiting" && "bg-[var(--agent-status-dot-waiting)]",
    )}
  />
);

export default AgentStatusDot;
