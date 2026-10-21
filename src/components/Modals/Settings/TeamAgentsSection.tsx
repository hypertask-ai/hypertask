"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7509_AGENT_ROLE_SCREEN_FLAG } from "@/lib/flags/keys";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import type { IAgent } from "@/models/model";
import { settingsUserId } from "@/lib/settingsTeamSelection";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import AgentSettingsList from "./AgentSettingsList";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const TeamAgentsSection = () => {
  const agentRolesEnabled = useFlag(HTPR_7509_AGENT_ROLE_SCREEN_FLAG);
  const currentUser = useRecoilValue(currentUserAtom);
  const { project, teamId, ownerAndMembers } = useSettingsTeam();
  const { agents, isLoading, changeAgentRole } = useAgents({
    projectId: project?.id,
    teamId,
  });
  const [editingAgent, setEditingAgent] = useState<IAgent | null>(null);
  useEffect(() => setEditingAgent(null), [teamId]);
  const canChangeRole = Boolean(
    currentUser && ownerAndMembers.owner?.id === settingsUserId(currentUser),
  );

  return (
    <SettingsSectionShell
      description="Agents attached to boards in the selected team."
      title="Agents"
    >
      {agentRolesEnabled && (
        <p className="-mt-[26px] text-meta text-text-light-gray">
          Read sees boards and tasks. Write also edits tasks and creates boards. Admin also gives other agents access.
        </p>
      )}
      <SettingsCard title={`${agents.length} agents`}>
        <AgentSettingsList
          agents={agents}
          emptyLabel="No agents are attached to this team"
          isLoading={isLoading}
          showBoards
          showRoles={agentRolesEnabled}
          onChangeRole={agentRolesEnabled && canChangeRole ? setEditingAgent : undefined}
          changingRole={changeAgentRole.isPending}
        />
      </SettingsCard>
      {agentRolesEnabled && canChangeRole && editingAgent && agents.some((agent) => agent.id === editingAgent.id) && (
        <OptionPickerModal
          header={`Role for ${editingAgent.displayName}`}
          options={[
            { id: "read", label: "Read · sees boards and tasks" },
            { id: "write", label: "Write · edits tasks, creates boards" },
            { id: "admin", label: "Admin · also gives other agents access" },
          ].map((option) => ({
            ...option,
            hint: (editingAgent.role ?? "write") === option.id ? "Current" : undefined,
          }))}
          onClose={() => setEditingAgent(null)}
          onSelect={(option) => {
            const agent = editingAgent;
            setEditingAgent(null);
            changeAgentRole.mutate(
              { id: agent.id, role: option.id as NonNullable<IAgent["role"]> },
              {
                onSuccess: () => toast.success(`${agent.displayName} is now ${option.id === "read" ? "Read" : option.id === "admin" ? "Admin" : "Write"}`),
                onError: (error) => toast.error(error.message),
              },
            );
          }}
        />
      )}
    </SettingsSectionShell>
  );
};

export default TeamAgentsSection;
