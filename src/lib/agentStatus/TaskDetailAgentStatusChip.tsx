import React from "react";
import { useFlag } from "@/hooks/useFlag";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import AgentStatusChip from "@/lib/agentStatus/AgentStatusChip";
import { HTPR_7339_AGENT_PULSE_DOT_FLAG } from "@/lib/flags/definitions/htpr-7339-agent-pulse-dot";

const TaskDetailAgentStatusChip = () => {
  const agentPulseDot = useFlag(HTPR_7339_AGENT_PULSE_DOT_FLAG);
  const { currentTask } = useTaskContext();
  if (!agentPulseDot || !currentTask?.agentStatus) return null;

  const sectionTitle = currentTask.project?.section?.find(
    (section) => section.id === currentTask.sectionId,
  )?.section_title;

  return (
    <div className="w-full pb-1">
      <AgentStatusChip
        agentName={currentTask.agentStatus.agentName}
        at={currentTask.agentStatus.at}
        sectionTitle={sectionTitle}
        pulseDot
      />
    </div>
  );
};

export default TaskDetailAgentStatusChip;
