"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import nookies from "nookies";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import ConfirmArchiveBoard from "@/components/Modals/commands/confirmArchiveBoard";
import ConfirmDeleteBoard from "@/components/Modals/commands/confirmDeleteBoard";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import {
  archivedProjectsForTeam,
  canLeaveBoard,
  canManageBoardLifecycle,
} from "@/lib/boardManagement";
import type { IProject } from "@/models/model";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { getArchivedProjects } from "@/utils/api/archived.ts";
import { archiveProjectById, leaveProject } from "@/utils/api/Homepage";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import { rememberSettingsReturnTo } from "./settingsNavigation";
import { useSettingsTeam } from "./useSettingsTeam";

type LifecycleDialog = "archive" | "delete" | "leave" | null;

const BoardLifecycleSettings = () => {
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const { project, teamId } = useSettingsTeam();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<LifecycleDialog>(null);
  const [leaving, setLeaving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const archivedQuery = useQuery<IProject[]>({
    queryKey: ["settingsArchivedProjects", currentUser?.id],
    queryFn: async () => {
      const response = await getArchivedProjects(currentUser!.id);
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: Boolean(currentUser?.id),
    refetchOnWindowFocus: false,
  });
  const archivedProjects = useMemo(
    () =>
      archivedProjectsForTeam(
        archivedQuery.data ?? [],
        teamId,
        currentUser?.id ?? null,
      ),
    [archivedQuery.data, currentUser?.id, teamId],
  );
  const canManage = Boolean(
    project && currentUser && canManageBoardLifecycle(project, currentUser.id),
  );
  const canLeave = Boolean(
    project && currentUser && canLeaveBoard(project, currentUser.id),
  );

  const refreshBoardData = useCallback(
    async (firstProject: IProject | null | undefined, removedProjectId: number) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["getAllTeamsMinimal"] }),
        queryClient.refetchQueries({ queryKey: ["projectsAll"] }),
        queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] }),
        queryClient.refetchQueries({ queryKey: ["getAllFavorites"] }),
        archivedQuery.refetch(),
      ]);

      if (currentProject?.id !== removedProjectId) return;

      if (firstProject?.id) {
        setCurrentProject(firstProject);
        const replacementPath = `/project?id=${firstProject.id}`;
        nookies.set(
          null,
          "previousBoard",
          `project-${firstProject.id}|&|undefined`,
          {
            maxAge: 600 * 60 * 24 * 7,
            path: "/",
          },
        );
        rememberSettingsReturnTo(replacementPath);
      } else {
        nookies.destroy(null, "previousBoard", { path: "/" });
        rememberSettingsReturnTo("/");
        setCurrentProject(null);
      }
    },
    [archivedQuery, currentProject?.id, queryClient, setCurrentProject],
  );

  const handleCompletedRemoval = useCallback(
    (response?: { data?: { firstProject?: IProject | null } }) => {
      setDialog(null);
      if (!response || !project) return;
      void refreshBoardData(response.data?.firstProject, project.id);
    },
    [project, refreshBoardData],
  );

  const handleLeave = async () => {
    if (!project || leaving) return;
    setLeaving(true);

    try {
      const response = await leaveProject({ projectId: project.id });
      setDialog(null);
      await refreshBoardData(response.data?.firstProject, project.id);
      toast.success(`Left ${project.title ?? project.name}`);
    } catch {
      toast.error("Unable to leave this board");
    } finally {
      setLeaving(false);
    }
  };

  const handleRestore = async (archivedProject: IProject) => {
    if (restoringId) return;
    setRestoringId(archivedProject.id);

    try {
      await archiveProjectById({ projectId: archivedProject.id });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["getAllTeamsMinimal"] }),
        queryClient.refetchQueries({ queryKey: ["projectsAll"] }),
        queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] }),
        queryClient.refetchQueries({ queryKey: ["getAllFavorites"] }),
        archivedQuery.refetch(),
      ]);
      toast.success(
        `Restored ${archivedProject.title ?? archivedProject.name}`,
      );
    } catch {
      toast.error("Unable to restore this board");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <>
      {project && (
        <SettingsCard title="Board management">
          <div className="flex flex-col">
            {canManage && (
              <>
                <BoardActionRow
                  action="Archive board"
                  description="Hide this board and its tasks until you restore it."
                  onClick={() => setDialog("archive")}
                />
                <BoardActionRow
                  action="Delete board"
                  danger
                  description="Permanently delete this board and all its tasks."
                  onClick={() => setDialog("delete")}
                />
              </>
            )}
            {canLeave && (
              <BoardActionRow
                action="Leave board"
                description="Remove your access to this board."
                onClick={() => setDialog("leave")}
              />
            )}
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="Archived boards">
        <div className="flex flex-col">
          {archivedQuery.isLoading ? (
            <p className="px-2 py-3 text-dense font-medium text-text-light-gray">
              Loading archived boards…
            </p>
          ) : archivedProjects.length === 0 ? (
            <p className="px-2 py-3 text-dense font-medium text-text-light-gray">
              No archived boards in this team.
            </p>
          ) : (
            archivedProjects.map((archivedProject) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-3"
                key={archivedProject.id}
              >
                <span className="min-w-0 truncate text-dense font-semibold text-white-black">
                  {archivedProject.title ?? archivedProject.name}
                </span>
                <button
                  className={settingsActionButtonClass}
                  disabled={Boolean(restoringId)}
                  onClick={() => void handleRestore(archivedProject)}
                  type="button"
                >
                  {restoringId === archivedProject.id
                    ? "Restoring…"
                    : "Restore"}
                </button>
              </div>
            ))
          )}
        </div>
      </SettingsCard>

      {dialog === "archive" && project && (
        <ConfirmArchiveBoard
          project={project}
          onClose={handleCompletedRemoval}
        />
      )}
      {dialog === "delete" && project && (
        <ConfirmDeleteBoard
          project={project}
          onClose={handleCompletedRemoval}
        />
      )}
      {dialog === "leave" && project && (
        <ConfirmDialog
          confirmLabel="Leave board"
          footerVerb="leave"
          icon={LogOut}
          id="leave-board-confirm"
          loading={leaving}
          loadingLabel="Leaving…"
          message={`Leave ${project.title ?? project.name}?`}
          onCancel={() => setDialog(null)}
          onConfirm={() => void handleLeave()}
        />
      )}
    </>
  );
};

const BoardActionRow = ({
  action,
  danger = false,
  description,
  onClick,
}: {
  action: string;
  danger?: boolean;
  description: string;
  onClick: () => void;
}) => (
  <div className="flex flex-col items-start gap-3 border-b border-light-black-border-1 px-2 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <p className="text-dense font-semibold text-white-black">{action}</p>
      <p className="text-meta font-medium text-text-light-gray">
        {description}
      </p>
    </div>
    <button
      className={`${settingsActionButtonClass} shrink-0 ${danger ? "!text-red-400" : ""}`}
      onClick={onClick}
      type="button"
    >
      {action}
    </button>
  </div>
);

export default BoardLifecycleSettings;
