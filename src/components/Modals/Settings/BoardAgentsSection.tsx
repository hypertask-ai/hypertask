"use client";

import { useAgents } from "@/hooks/MultiPages/useAgents";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7577_ADD_EXISTING_AGENT_FLAG } from "@/lib/flags/keys";
import AddExistingAgentButton from "./AddExistingAgentButton";
import AgentSettingsList from "./AgentSettingsList";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const BoardAgentsSection = () => {
  const addExistingAgentEnabled = useFlag(HTPR_7577_ADD_EXISTING_AGENT_FLAG);
  const { project, teamId } = useSettingsTeam();
  const { allAgents, isBoardAgentsLoading } = useAgents({
    projectId: project?.id,
    teamId,
  });

  return (
    <SettingsSectionShell
      description="Agents attached to the selected board."
      title="Agents"
      headerAction={addExistingAgentEnabled && project ? (
        <AddExistingAgentButton
          key={project.id}
          projectId={project.id}
          boardName={project.title ?? project.name}
          boardTeamId={project.teamId ?? teamId}
        />
      ) : undefined}
    >
      <SettingsCard title={`${allAgents.length} agents`}>
        <AgentSettingsList
          agents={allAgents}
          emptyLabel="No agents are attached to this board"
          isLoading={isBoardAgentsLoading}
        />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default BoardAgentsSection;
