"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { IProject, IProjectsAll } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

const STALE_WARN_DEFAULT_DAYS = 7;
const STALE_HOT_DEFAULT_DAYS = 20;
const AUTO_ARCHIVE_DEFAULT_DAYS = 180;

type StalenessUpdate = {
  enabled: boolean;
  warnDays?: number;
  hotDays?: number;
  nudgeEnabled?: boolean;
};

const BoardStalenessSetting = ({ project }: { project: IProject }) => {
  const queryClient = useQueryClient();
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const [warnDraft, setWarnDraft] = useState(
    String(project.staleWarnDays ?? STALE_WARN_DEFAULT_DAYS),
  );
  const [hotDraft, setHotDraft] = useState(
    String(project.staleHotDays ?? STALE_HOT_DEFAULT_DAYS),
  );
  const mutation = useMutation({
    mutationFn: async (update: StalenessUpdate) => {
      await axios.post("/api/projects/staleness", {
        projectId: project.id,
        ...update,
      });
    },
    onMutate: async (update) => {
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
      const updateProject = (candidate: IProject) =>
        candidate.id === previousProject.id
          ? {
              ...candidate,
              stalenessEnabled: update.enabled,
              ...(update.warnDays === undefined
                ? {}
                : { staleWarnDays: update.warnDays }),
              ...(update.hotDays === undefined
                ? {}
                : { staleHotDays: update.hotDays }),
              ...(update.nudgeEnabled === undefined
                ? {}
                : { staleNudgeEnabled: update.nudgeEnabled }),
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
    onError: (_error, _update, context) => {
      if (context?.previousProject) setCurrentProject(context.previousProject);
      queryClient.setQueryData(["projectsAll"], context?.previousProjects);
      queryClient.setQueryData(
        ["projectsAllMinimal"],
        context?.previousMinimal,
      );
      toast.error("Unable to update staleness");
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] }),
      ]);
    },
  });

  const warnDays = project.staleWarnDays ?? STALE_WARN_DEFAULT_DAYS;
  const hotDays = project.staleHotDays ?? STALE_HOT_DEFAULT_DAYS;

  useEffect(() => {
    setWarnDraft(String(warnDays));
    setHotDraft(String(hotDays));
  }, [hotDays, project.id, warnDays]);

  const saveThreshold = (field: "warn" | "hot") => {
    const nextWarnDays = field === "warn" ? Number(warnDraft) : warnDays;
    const nextHotDays = field === "hot" ? Number(hotDraft) : hotDays;
    const value = field === "warn" ? nextWarnDays : nextHotDays;
    if (!Number.isInteger(value) || value <= 0) {
      if (field === "warn") setWarnDraft(String(warnDays));
      else setHotDraft(String(hotDays));
      toast.error("Days must be a positive whole number");
      return;
    }
    if (nextWarnDays >= nextHotDays) {
      if (field === "warn") setWarnDraft(String(warnDays));
      else setHotDraft(String(hotDays));
      toast.error("Warn days must be less than hot days");
      return;
    }
    if (value === (field === "warn" ? warnDays : hotDays)) return;
    mutation.mutate({
      enabled: project.stalenessEnabled,
      ...(field === "warn" ? { warnDays: value } : { hotDays: value }),
    });
  };

  const thresholdField = (
    field: "warn" | "hot",
    label: string,
    value: string,
    setValue: (value: string) => void,
  ) => (
    <div className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2">
      <label
        className="shrink-0 text-dense font-semibold text-white-black"
        htmlFor={`board-stale-${field}-days`}
      >
        {label}
      </label>
      <input
        className="h-8 w-20 border-0 bg-transparent px-2 text-right text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
        disabled={mutation.isPending}
        id={`board-stale-${field}-days`}
        min={1}
        onBlur={() => saveThreshold(field)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        step={1}
        type="number"
        value={value}
      />
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <SettingsToggle
          checked={project.stalenessEnabled}
          disabled={mutation.isPending}
          inputId="board-staleness"
          label="Staleness"
          onChange={() =>
            mutation.mutate({ enabled: !project.stalenessEnabled })
          }
        />
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Show how long tasks have been sitting. Applies to this board only.
        </p>
      </div>
      {project.stalenessEnabled && (
        <div className="flex flex-col">
          {thresholdField(
            "warn",
            "Warn after (days)",
            warnDraft,
            setWarnDraft,
          )}
          {thresholdField(
            "hot",
            "Hot after (days)",
            hotDraft,
            setHotDraft,
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <SettingsToggle
          checked={project.staleNudgeEnabled}
          disabled={mutation.isPending}
          inputId="board-stale-reminders"
          label="Stale reminders"
          onChange={() =>
            mutation.mutate({
              enabled: project.stalenessEnabled,
              nudgeEnabled: !project.staleNudgeEnabled,
            })
          }
        />
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Notify assignees when a task goes stale. Applies to this board only.
        </p>
      </div>
    </>
  );
};

const BoardAutoArchiveSetting = ({ project }: { project: IProject }) => {
  const queryClient = useQueryClient();
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const [daysDraft, setDaysDraft] = useState(
    String(project.autoArchiveAfterDays ?? AUTO_ARCHIVE_DEFAULT_DAYS),
  );
  const mutation = useMutation({
    mutationFn: async ({
      days,
      enabled,
    }: {
      days?: number;
      enabled: boolean;
    }) => {
      await axios.post("/api/projects/auto-archive", {
        projectId: project.id,
        enabled,
        ...(days === undefined ? {} : { days }),
      });
    },
    onMutate: async ({ days, enabled }) => {
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
      const autoArchiveAfterDays = enabled
        ? (days ?? AUTO_ARCHIVE_DEFAULT_DAYS)
        : null;
      const updateProject = (candidate: IProject) =>
        candidate.id === previousProject.id
          ? { ...candidate, autoArchiveAfterDays }
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
      toast.error("Unable to update auto-archive");
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] }),
      ]);
    },
  });
  const enabled = project.autoArchiveAfterDays != null;

  useEffect(() => {
    setDaysDraft(
      String(project.autoArchiveAfterDays ?? AUTO_ARCHIVE_DEFAULT_DAYS),
    );
  }, [project.autoArchiveAfterDays, project.id]);

  const saveDays = () => {
    const days = Number(daysDraft);
    if (!Number.isInteger(days) || days <= 0) {
      setDaysDraft(
        String(project.autoArchiveAfterDays ?? AUTO_ARCHIVE_DEFAULT_DAYS),
      );
      toast.error("Days must be a positive whole number");
      return;
    }
    if (days === project.autoArchiveAfterDays) return;
    mutation.mutate({ days, enabled: true });
  };

  return (
    <div className="flex flex-col gap-1">
      <SettingsToggle
        checked={enabled}
        disabled={mutation.isPending}
        inputId="board-auto-archive"
        label="Auto-archive"
        onChange={() => mutation.mutate({ enabled: !enabled })}
      />
      {enabled && (
        <div className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-2">
          <label
            className="shrink-0 text-dense font-semibold text-white-black"
            htmlFor="board-auto-archive-days"
          >
            Days
          </label>
          <input
            className="h-8 w-20 border-0 bg-transparent px-2 text-right text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
            disabled={mutation.isPending}
            id="board-auto-archive-days"
            min={1}
            onBlur={saveDays}
            onChange={(event) => setDaysDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            step={1}
            type="number"
            value={daysDraft}
          />
        </div>
      )}
      <p className="px-2 text-dense font-medium text-text-light-gray">
        Automatically archive tasks with no activity for this many days. Applies
        to this board only.
      </p>
    </div>
  );
};

const BoardStalenessSection = () => {
  const { project } = useSettingsTeam();

  if (!project) return null;

  return (
    <SettingsSectionShell title="Staleness">
      <BoardStalenessSetting project={project} />
      <BoardAutoArchiveSetting project={project} />
    </SettingsSectionShell>
  );
};

export default BoardStalenessSection;
