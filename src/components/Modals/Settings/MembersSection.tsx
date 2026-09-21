"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { UserPlus, X } from "lucide-react";
import { CommandMode } from "@/models/enums";
import { IProject, IUser } from "@/models/model";
import { currentProjectAtom, currentUserAtom, showCommandsAtom } from "@/store";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import useInviteCallbackHandlers from "@/hooks/MultiPages/useInviteCallbackHandlers";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { normalizeDomain } from "@/lib/auth/emailDomain";
import { useSettingsNavigation } from "./settingsNavigation";
import { useSettingsTeam } from "./useSettingsTeam";
import SettingsMemberRow from "./SettingsMemberRow";

const actionButtonClass =
  "inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

const MembersSection = () => {
  const { closeSettings } = useSettingsNavigation();
  const currentUser = useRecoilValue(currentUserAtom) as IUser | null;
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const {
    isLoading,
    ownerAndMembers,
    project,
    refetchMembers,
    refetchTeam,
    team,
  } = useSettingsTeam();
  const { changeMemberRole } = useInviteCallbackHandlers();
  const [isRenaming, setIsRenaming] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [isSavingDomains, setIsSavingDomains] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [memberPendingRemoval, setMemberPendingRemoval] =
    useState<IUser | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [title, setTitle] = useState(team?.title ?? "");
  // Board-level admin role (Member.role) is scoped to the current project, not
  // the team — fetched separately from the team member list above.
  const [projectMemberRoles, setProjectMemberRoles] = useState<
    Record<number, "Admin" | "Member">
  >({});
  const [changingRoleUserId, setChangingRoleUserId] = useState<number | null>(
    null
  );

  useEffect(() => {
    setTitle(team?.title ?? "");
  }, [team?.title]);

  const refetchProjectMemberRoles = useCallback(async () => {
    if (!project?.id) {
      setProjectMemberRoles({});
      return;
    }

    const response = await fetch(`/api/members/getAll?projectId=${project.id}`);
    if (!response.ok) return;

    const data = await response.json();
    const roles: Record<number, "Admin" | "Member"> = {};
    (data.members ?? []).forEach((member: any) => {
      roles[member.userId] = member.role;
    });
    setProjectMemberRoles(roles);
  }, [project?.id]);

  useEffect(() => {
    refetchProjectMemberRoles();
  }, [refetchProjectMemberRoles]);

  const teamRows = useMemo(() => {
    const rows: Array<{
      isOwner: boolean;
      isProjectMember: boolean;
      role: "Admin" | "Member";
      user: IUser;
    }> = [];

    if (ownerAndMembers.owner) {
      rows.push({
        isOwner: true,
        isProjectMember: true,
        role: "Admin",
        user: ownerAndMembers.owner,
      });
    }

    ownerAndMembers.members.forEach((member) => {
      if (!member) return;
      rows.push({
        isOwner: false,
        isProjectMember: member.id in projectMemberRoles,
        role: projectMemberRoles[member.id] ?? "Member",
        user: member,
      });
    });

    return rows;
  }, [ownerAndMembers, projectMemberRoles]);

  const usedSeats = teamRows.length;
  const totalSeats = team?.totalSeats ?? 0;
  const canManageMembers = Boolean(
    team &&
      currentUser &&
      ((currentUser.accountId && team.googleAccountId === currentUser.accountId) ||
        ownerAndMembers.owner?.id === currentUser.id)
  );

  const domains = team?.allowedEmailDomains ?? [];

  const saveDomains = async (next: string[]) => {
    if (!team) return;

    setIsSavingDomains(true);
    try {
      await axios.post("/api/teams/updateAllowedDomains", {
        teamId: team.id,
        domains: next,
      });
      await refetchTeam();
      setDomainInput("");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ?? "Could not update domains"
      );
    } finally {
      setIsSavingDomains(false);
    }
  };

  const addDomain = () => {
    const result = normalizeDomain(domainInput);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    if (domains.includes(result.domain)) {
      setDomainInput("");
      return;
    }
    saveDomains([...domains, result.domain]);
  };

  const confirmNameChange = async () => {
    if (!team || !title.trim()) return;

    setIsSavingName(true);
    try {
      const response = await axios.post("/api/teams/changeTeamName", {
        updatedTitle: title.trim(),
        teamId: team.id,
      });

      if (response.status === 200) {
        await refetchTeam();
        setIsRenaming(false);
      }
    } catch (error) {
      console.error(error);
      toast.error("Could not rename team");
    } finally {
      setIsSavingName(false);
    }
  };

  const openInviteFlow = () => {
    if (!project?.id || !project.teamId) {
      toast.error("Open a board before inviting members");
      return;
    }

    setCurrentProject(project as IProject);
    closeSettings();
    setShowCommands({ show: true, mode: CommandMode.InviteMember });
  };

  const removeTeamMember = async (member: IUser) => {
    if (!team?.id) return;

    setRemovingMemberId(member.id);
    try {
      const response = await axios.post("/api/members/removeTeamMember", {
        teamId: team.id,
        userId: member.id,
      });

      if (response.status === 200) {
        setMemberPendingRemoval(null);
        await Promise.all([refetchMembers(), refetchTeam()]);
        toast.success("Member removed");
      }
    } catch (error) {
      console.error(error);
      toast.error("Could not remove member");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const toggleMemberRole = async (member: IUser, currentRole: "Admin" | "Member") => {
    if (!project?.id) return;

    setChangingRoleUserId(member.id);
    try {
      await changeMemberRole(
        member,
        currentRole === "Admin" ? "Member" : "Admin",
        project as IProject
      );
      await refetchProjectMemberRoles();
    } catch (error) {
      console.error(error);
      toast.error("Could not change member role");
    } finally {
      setChangingRoleUserId(null);
    }
  };

  return (
    <SettingsSectionShell title="Members">
      <SettingsCard title="Team">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active">
            <span className="shrink-0 text-dense font-semibold text-white-black">
              Name
            </span>
            {isRenaming ? (
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <input
                  autoFocus
                  className="h-8 min-w-0 flex-1 rounded-[8px] border border-border-light-gray-thin bg-modalBackground px-2 text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmNameChange();
                    if (event.key === "Escape") setIsRenaming(false);
                  }}
                  placeholder="Team name"
                  value={title}
                />
                <button
                  className={actionButtonClass}
                  disabled={isSavingName}
                  onClick={confirmNameChange}
                  type="button"
                >
                  Save
                </button>
                <button
                  className={actionButtonClass}
                  onClick={() => {
                    setTitle(team?.title ?? "");
                    setIsRenaming(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <span className="min-w-0 truncate text-dense font-medium text-text-light-gray">
                  {team?.title ?? "No team selected"}
                </span>
                <button
                  className={actionButtonClass}
                  disabled={!team}
                  onClick={() => setIsRenaming(true)}
                  type="button"
                >
                  Rename
                </button>
              </div>
            )}
          </div>
          <div className="px-2 text-dense font-medium text-text-light-gray">
            {usedSeats} of {totalSeats} seats used
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Auto-join">
        <div className="flex flex-col gap-2 px-2">
          <p className="text-[13px] font-medium text-text-light-gray">
            Anyone signing up with a verified email on these domains joins this
            team automatically. A seat is billed like an invite.
          </p>
          {domains.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {domains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1 rounded-[5px] bg-active-modal-element px-1.5 py-[1px] text-[13px] font-medium text-white-black"
                >
                  {domain}
                  {canManageMembers && (
                    <button
                      aria-label={`Remove ${domain}`}
                      className="text-text-light-gray transition hover:text-white-black disabled:cursor-not-allowed"
                      disabled={isSavingDomains}
                      onClick={() => saveDomains(domains.filter((d) => d !== domain))}
                      type="button"
                    >
                      <X strokeWidth={1.75} className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {canManageMembers ? (
            <div className="flex items-center gap-2">
              <input
                className="h-8 min-w-0 flex-1 rounded-[8px] border border-border-light-gray-thin bg-modalBackground px-2 text-[13px] font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
                onChange={(event) => setDomainInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addDomain();
                }}
                placeholder="acme.com"
                value={domainInput}
              />
              <button
                className={actionButtonClass}
                disabled={!team || isSavingDomains || !domainInput.trim()}
                onClick={addDomain}
                type="button"
              >
                {isSavingDomains ? "Saving…" : "Add"}
              </button>
            </div>
          ) : (
            domains.length === 0 && (
              <p className="text-[13px] font-medium text-text-light-gray">
                No domains configured.
              </p>
            )
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Members">
        <div className="flex items-center justify-between gap-3 px-2">
          <span className="text-dense font-medium text-text-light-gray">
            {isLoading ? "Loading members" : `${teamRows.length} people`}
          </span>
          <button
            className={actionButtonClass}
            disabled={!project?.id || !project.teamId}
            onClick={openInviteFlow}
            type="button"
          >
            <UserPlus strokeWidth={1.75} className="h-4 w-4" />
            Invite
          </button>
        </div>

        <div className="flex flex-col gap-1">
          {teamRows.length > 0 ? (
            teamRows.map(({ isOwner, isProjectMember, role, user }) => {
              const confirmRemoval = memberPendingRemoval?.id === user.id;
              const removing = removingMemberId === user.id;
              const togglingRole = changingRoleUserId === user.id;

              return (
                <div key={`${role}-${user.id}`} className="flex flex-col">
                  <SettingsMemberRow
                    canRemove={canManageMembers && !isOwner}
                    canToggleRole={canManageMembers && !isOwner && isProjectMember}
                    onRemove={() => setMemberPendingRemoval(user)}
                    onToggleRole={() => toggleMemberRole(user, role)}
                    role={role}
                    togglingRole={togglingRole}
                    user={user}
                  />
                  {confirmRemoval && (
                    <div className="mt-2 flex flex-col gap-3 border-t border-border-light-gray-thin px-2 pt-4 text-dense text-white-black">
                      {removing ? (
                        <p className="font-medium text-text-light-gray">
                          Removing member. Please wait.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1">
                            <p className="font-semibold">
                              Remove {user.displayName || user.email || "this member"}?
                            </p>
                            <p className="font-medium text-text-light-gray">
                              This will remove them from the team and unassign
                              them from all tasks.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className={actionButtonClass}
                              onClick={() => setMemberPendingRemoval(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className={actionButtonClass}
                              onClick={() => removeTeamMember(user)}
                              type="button"
                            >
                              Confirm
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-[5px] px-2 py-2 text-dense font-medium text-text-light-gray">
              {isLoading ? "Loading team members" : "No members found"}
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default MembersSection;
