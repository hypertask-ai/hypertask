"use client";

import { useAgents } from "@/hooks/MultiPages/useAgents";
import AgentSettingsList from "./AgentSettingsList";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const TeamAgentsSection = () => {
  const { project, teamId } = useSettingsTeam();
  const { agents, isLoading } = useAgents({
    projectId: project?.id,
    teamId,
  });

  return (
    <SettingsSectionShell
      description="Agents attached to boards in the selected team."
      title="Agents"
    >
      <SettingsCard title={`${agents.length} agents`}>
        <AgentSettingsList
          agents={agents}
          emptyLabel="No agents are attached to this team"
          isLoading={isLoading}
          showBoards
        />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default TeamAgentsSection;
