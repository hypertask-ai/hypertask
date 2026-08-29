"use client";

import { useAgents } from "@/hooks/MultiPages/useAgents";
import AgentSettingsList from "./AgentSettingsList";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const BoardAgentsSection = () => {
  const { project, teamId } = useSettingsTeam();
  const { allAgents, isBoardAgentsLoading } = useAgents({
    projectId: project?.id,
    teamId,
  });

  return (
    <SettingsSectionShell
      description="Agents attached to the selected board."
      title="Agents"
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
