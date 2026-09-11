"use client";

import axios from "axios";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import AssignModal from "@/components/Modals/AssignToUser/AssignToUser";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import {
  hasNoSectionAutoAssign,
  sectionAutoAssignTargetFor,
} from "@/lib/sectionAutoAssign";
import {
  IMember,
  IProject,
  IProjectsAll,
  ISection,
  IAgent,
  IUser,
} from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";
import BoardLifecycleSettings from "./BoardLifecycleSettings";

const NONE_ASSIGNEE = {
  id: 0,
  displayName: "None",
  assigned: false,
} as IUser;

const BoardNotificationSetting = ({ project }: { project: IProject }) => {
  const queryKey = ["projectNotificationMute", project.id] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await axios.get<{ muted: boolean }>(
        "/api/notifications/project-mute",
        { params: { projectId: project.id } },
      );
      return response.data;
    },
  });
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (muted: boolean) => {
      const response = await axios.post<{ muted: boolean }>(
        "/api/notifications/project-mute",
        { projectId: project.id, muted },
      );
      return response.data;
    },
    onMutate: async (muted) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ muted: boolean }>(queryKey);
      queryClient.setQueryData(queryKey, { muted });
      return { previous };
    },
    onError: (_error, _muted, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error("Unable to update board notifications");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const muted = data?.muted ?? false;

  return (
    <div className="flex flex-col gap-1">
      <SettingsToggle
        checked={!muted}
        disabled={isLoading || mutation.isPending}
        inputId="board-notifications"
        label="Board notifications"
        onChange={() => mutation.mutate(!muted)}
      />
      <p className="px-2 text-dense font-medium text-text-light-gray">
        Receive inbox, email, and push notifications from {project.title ?? project.name}.
        Direct replies from agents still appear in your inbox.
      </p>
    </div>
  );
};

const BoardTimeTrackingSetting = ({ project }: { project: IProject }) => {
  const queryClient = useQueryClient();
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const mutation = useMutation({
    mutationFn: async (settings: {
      enabled?: boolean;
      showTimeTotals?: boolean;
    }) => {
      await axios.post("/api/projects/time-tracking", {
        projectId: project.id,
        ...settings,
      });
    },
    onMutate: async (settings) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projectsAll"] }),
        queryClient.cancelQueries({ queryKey: ["projectsAllMinimal"] }),
      ]);
      const previousProject = project;
      const previousProjects = queryClient.getQueryData<IProjectsAll>([
        "projectsAll",
      ]);
      const previousMinimal = queryClient.getQueryData<IProject[]>([
        "projectsAllMinimal",
      ]);
      const updateProject = (candidate: IProject) => {
        if (candidate.id !== previousProject.id) return candidate;
        return {
          ...candidate,
          ...(settings.enabled !== undefined
            ? { timeTrackingEnabled: settings.enabled }
            : {}),
          ...(settings.showTimeTotals !== undefined
            ? { showTimeTotals: settings.showTimeTotals }
            : settings.enabled === false
              ? { showTimeTotals: false }
              : {}),
        };
      };

      setCurrentProject(updateProject(previousProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? {
              ...current,
              updatedProjects: current.updatedProjects.map(updateProject),
            }
          : current,
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject),
      );

      return { previousMinimal, previousProject, previousProjects };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previousProject) setCurrentProject(context.previousProject);
      queryClient.setQueryData(["projectsAll"], context?.previousProjects);
      queryClient.setQueryData(
        ["projectsAllMinimal"],
        context?.previousMinimal,
      );
      toast.error("Unable to update time tracking");
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] }),
        queryClient.invalidateQueries({ queryKey: ["time"] }),
      ]);
    },
  });

  return (
    <div className="flex flex-col gap-1">
      <SettingsToggle
        checked={project.timeTrackingEnabled}
        disabled={mutation.isPending}
        inputId="board-time-tracking"
        label="Time tracking"
        onChange={() =>
          mutation.mutate({ enabled: !project.timeTrackingEnabled })
        }
      />
      <p className="px-2 text-dense font-medium text-text-light-gray">
        Track time on tasks in {project.title ?? project.name}. This setting only
        applies to this board.
      </p>
      {project.timeTrackingEnabled && (
        <div className="mt-2 flex flex-col gap-1 pl-4">
          <SettingsToggle
            checked={Boolean(project.showTimeTotals)}
            disabled={mutation.isPending}
            inputId="board-show-time-totals"
            label="Show total time on tasks"
            onChange={() =>
              mutation.mutate({ showTimeTotals: !project.showTimeTotals })
            }
          />
          <p className="px-2 text-dense font-medium text-text-light-gray">
            Show tracked totals on board cards and in the table view.
          </p>
        </div>
      )}
    </div>
  );
};

interface BoardMembersData {
  boardAgents?: IAgent[];
  members?: IMember[];
  owner?: IUser | null;
}

const BoardAutoAssignSetting = ({ project }: { project: IProject }) => {
  const queryClient = useQueryClient();
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(
    null,
  );
  const { data } = useGetAllMembersForAssign(
    ["assign", project.id],
    project.id,
    { members: [], owner: null },
  );
  const { agentsById, membersById } = useMemo(() => {
    const boardData = data as BoardMembersData;
    const members = new Map<number, IUser>();
    const agents = new Map<string, IAgent>();

    if (boardData.owner) members.set(boardData.owner.id, boardData.owner);
    for (const member of boardData.members ?? []) {
      if (member.user) members.set(member.user.id, member.user);
    }
    for (const agent of boardData.boardAgents ?? []) {
      agents.set(agent.id, agent);
    }

    return { agentsById: agents, membersById: members };
  }, [data]);
  const sections = project.section ?? project.sections ?? [];
  const selectedSection = sections.find(
    (section) => (section.id ?? section.sectionId) === selectedSectionId,
  );
  const mutation = useMutation({
    mutationFn: async ({
      autoAssignAgentId,
      autoAssignUserId,
      sectionId,
    }: {
      autoAssignAgentId: string | null;
      autoAssignUserId: number | null;
      sectionId: number;
    }) => {
      await axios.post("/api/sections/auto-assign", {
        sectionId,
        autoAssignUserId,
        autoAssignAgentId,
      });
    },
    onMutate: async ({ autoAssignAgentId, autoAssignUserId, sectionId }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projectsAll"] }),
        queryClient.cancelQueries({ queryKey: ["projectsAllMinimal"] }),
      ]);
      const previousProject = project;
      const previousProjects = queryClient.getQueryData<IProjectsAll>([
        "projectsAll",
      ]);
      const previousMinimal = queryClient.getQueryData<IProject[]>([
        "projectsAllMinimal",
      ]);
      const updateSections = (sections?: ISection[]) =>
        sections?.map((section) =>
          (section.id ?? section.sectionId) === sectionId
            ? { ...section, autoAssignUserId, autoAssignAgentId }
            : section,
        );
      const updateProject = (candidate: IProject) =>
        candidate.id === previousProject.id
          ? {
              ...candidate,
              section: updateSections(candidate.section),
              sections: updateSections(candidate.sections) ?? candidate.sections,
              filteredSections:
                updateSections(candidate.filteredSections) ??
                candidate.filteredSections,
            }
          : candidate;

      setCurrentProject(updateProject(previousProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? {
              ...current,
              updatedProjects: current.updatedProjects.map(updateProject),
            }
          : current,
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject),
      );

      return { previousMinimal, previousProject, previousProjects };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousProject) setCurrentProject(context.previousProject);
      queryClient.setQueryData(["projectsAll"], context?.previousProjects);
      queryClient.setQueryData(
        ["projectsAllMinimal"],
        context?.previousMinimal,
      );
      toast.error("Unable to update column auto-assign");
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] }),
      ]);
    },
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-[28px] items-center px-2 py-1">
        <h3 className="text-dense font-semibold text-white-black">
          Auto-assign by column
        </h3>
      </div>
      <p className="px-2 text-dense font-medium text-text-light-gray">
        Automatically assign someone when a task moves into a column.
      </p>
      <div className="mt-2 flex flex-col">
        {sections.map((section) => {
          const sectionId = section.id ?? section.sectionId;
          if (!sectionId) return null;
          const assignee = section.autoAssignUserId
            ? membersById.get(section.autoAssignUserId)
            : null;
          const agent = section.autoAssignAgentId
            ? agentsById.get(section.autoAssignAgentId)
            : null;
          const assigneeName =
            section.autoAssignUserId == null
              ? section.autoAssignAgentId == null
                ? "None"
                : agent?.displayName || "Agent"
              : assignee?.displayName || assignee?.email || "Member";

          return (
            <button
              className="flex min-h-[40px] items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2 text-left transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              disabled={mutation.isPending}
              key={sectionId}
              onClick={() => setSelectedSectionId(sectionId)}
              type="button"
            >
              <span className="min-w-0 truncate text-dense font-semibold text-white-black">
                {section.section_title}
              </span>
              <span className="shrink-0 text-dense font-medium text-text-light-gray">
                {assigneeName}
              </span>
            </button>
          );
        })}
      </div>
      {selectedSection && selectedSectionId && (
        <AssignModal
          assignees={[]}
          extraUsers={[
            {
              ...NONE_ASSIGNEE,
              assigned: hasNoSectionAutoAssign(selectedSection),
            },
          ]}
          includeAgents
          mode="Create"
          onClose={(assignee?: IUser | IAgent) => {
            if (!assignee) return setSelectedSectionId(null);
            setSelectedSectionId(null);
            mutation.mutate({
              ...sectionAutoAssignTargetFor(assignee),
              sectionId: selectedSectionId,
            });
          }}
          project={project}
          selectedUserIds={
            selectedSection.autoAssignUserId
              ? [selectedSection.autoAssignUserId]
              : []
          }
          selectedAgentIds={
            selectedSection.autoAssignAgentId
              ? [selectedSection.autoAssignAgentId]
              : []
          }
          title={`Auto-assign for ${selectedSection.section_title}`}
        />
      )}
    </div>
  );
};

const BoardGeneralSection = () => {
  const { project } = useSettingsTeam();

  return (
    <SettingsSectionShell title="General">
      {project && <BoardNotificationSetting project={project} />}
      {project && <BoardTimeTrackingSetting project={project} />}
      <BoardLifecycleSettings />
      {project && <BoardAutoAssignSetting project={project} />}
    </SettingsSectionShell>
  );
};

export default BoardGeneralSection;
