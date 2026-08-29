"use client";

import { useMemo } from "react";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IMember, IUser } from "@/models/model";
import SettingsCard from "./SettingsCard";
import SettingsMemberRow from "./SettingsMemberRow";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

interface BoardMembersData {
  members?: IMember[];
  owner?: IUser;
}

const BoardMembersSection = () => {
  const { project } = useSettingsTeam();
  const projectId = project?.id ?? 0;
  const { data, isFetching } = useGetAllMembersForAssign(
    ["assign", projectId],
    projectId,
    { members: [], owner: null }
  );

  const rows = useMemo(() => {
    const boardData = data as BoardMembersData;
    const result: Array<{
      role: "Admin" | "Member";
      user: IUser;
    }> = [];
    const seenUserIds = new Set<number>();

    if (boardData.owner) {
      seenUserIds.add(boardData.owner.id);
      result.push({ role: "Admin", user: boardData.owner });
    }

    for (const member of boardData.members ?? []) {
      if (!member.user || seenUserIds.has(member.user.id)) continue;
      seenUserIds.add(member.user.id);
      result.push({
        role: member.role === "Admin" ? "Admin" : "Member",
        user: member.user,
      });
    }

    return result;
  }, [data]);

  return (
    <SettingsSectionShell
      description="People with access to the selected board."
      title="Members"
    >
      <SettingsCard title={`${rows.length} people`}>
        {isFetching ? (
          <div className="rounded-[5px] px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading members
          </div>
        ) : rows.length > 0 ? (
          <div className="flex flex-col gap-1">
            {rows.map(({ role, user }) => (
              <SettingsMemberRow key={user.id} role={role} user={user} />
            ))}
          </div>
        ) : (
          <div className="rounded-[5px] px-2 py-2 text-dense font-medium text-text-light-gray">
            No members found
          </div>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default BoardMembersSection;
