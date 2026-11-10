import React from "react";
import { FaRobot } from "react-icons/fa6";
import LabelWrapper from "@/components/Labels/LabelWrapper";
import AgentStatusDot from "@/components/agentStatus/AgentStatusDot";
import { agentStatusDotMode, agentStatusDotStep } from "@/lib/agentStatus/dot";
import {
  agentStatusIsFresh,
  agentStatusText,
} from "@/lib/agentStatus/chip";
import { useMinuteClock } from "@/lib/agentStatus/minuteClock";

type AgentStatusChipProps = {
  agentName: string;
  at: string;
  sectionTitle?: string | null;
  labelValues?: readonly string[];
  pulseDot: boolean;
  className?: string;
  truncate?: boolean;
};

const AgentStatusChip: React.FC<AgentStatusChipProps> = ({
  agentName,
  at,
  sectionTitle,
  labelValues = [],
  pulseDot,
  className,
  truncate = false,
}) => {
  const agentMinute = useMinuteClock(true);
  if (!agentStatusIsFresh(at, agentMinute)) return null;
  const step = agentStatusDotStep(sectionTitle, labelValues);
  const line = agentStatusText(agentName, step, at);
  const dotMode = pulseDot ? agentStatusDotMode(at, step, agentMinute) : null;

  return (
    <LabelWrapper
      title={line}
      className={className ?? (truncate ? "min-w-0 max-w-full overflow-hidden" : undefined)}
      data-testid="agent-status-chip"
    >
      {dotMode ? <AgentStatusDot mode={dotMode} /> : null}
      <FaRobot className="h-3 w-3 shrink-0 text-icon-dark-gray" />
      <span className={truncate ? "min-w-0 truncate" : undefined}>{line}</span>
    </LabelWrapper>
  );
};

export default AgentStatusChip;
