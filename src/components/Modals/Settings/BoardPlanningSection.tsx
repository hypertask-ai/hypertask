"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { cycleDateRange } from "@/lib/cycles";
import {
  PROJECT_HEALTH_LABELS,
  PROJECT_HEALTH_VALUES,
  ProjectHealthValue,
  projectPlanningQueryKey,
} from "@/lib/projectPlanning";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

interface ProjectMilestone {
  completedAt: string | null;
  createdAt: string;
  id: string;
  targetDate: string;
  title: string;
}

interface ProjectStatusUpdate {
  author: { displayName: string | null; id: number; photoURL: string | null };
  createdAt: string;
  health: ProjectHealthValue;
  id: string;
  message: string;
}

interface ProjectCycle {
  endDate: string;
  id: number;
  number: number;
  projectId: number;
  rolledOverAt: string | null;
  startDate: string;
}

interface ProjectPlanning {
  canManage: boolean;
  cycles: {
    current: ProjectCycle | null;
    enabled: boolean;
    next: ProjectCycle | null;
  };
  id: number;
  milestones: ProjectMilestone[];
  statusUpdates: ProjectStatusUpdate[];
  targetDate: string | null;
}

interface PlanningResponse {
  planning: ProjectPlanning;
  success: true;
}

const FIELD_CLASS =
  "min-h-[36px] w-full border-0 border-b border-light-black-border-1 bg-transparent px-2 py-2 text-dense text-white-black outline-none placeholder:text-text-light-gray focus:border-light-black-border-1 focus:ring-0";

const formatDate = (date: string) => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const formatTimestamp = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));

export default function BoardPlanningSection() {
  const { project } = useSettingsTeam();
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const queryKey = projectPlanningQueryKey(projectId ?? 0);
  const { data, isError, isLoading } = useQuery({
    enabled: Boolean(projectId),
    queryKey,
    queryFn: async () =>
      (
        await axios.get<PlanningResponse>("/api/projects/planning", {
          params: { projectId },
        })
      ).data.planning,
  });
  const [targetDate, setTargetDate] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [health, setHealth] = useState<ProjectHealthValue>("OnTrack");
  const [message, setMessage] = useState("");
  const [milestoneToRemove, setMilestoneToRemove] =
    useState<ProjectMilestone | null>(null);

  useEffect(() => setTargetDate(data?.targetDate ?? ""), [data?.targetDate]);

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (
        await axios.post<PlanningResponse>("/api/projects/planning", {
          projectId,
          ...body,
        })
      ).data.planning,
    onSuccess: (planning) => queryClient.setQueryData(queryKey, planning),
    onError: (error: any) => {
      setTargetDate(data?.targetDate ?? "");
      toast.error(error?.response?.data?.error ?? "Unable to update planning");
    },
  });

  if (!project) return null;

  return (
    <SettingsSectionShell
      description={`Plan ${project.title ?? project.name} and keep its health current.`}
      title="Planning"
    >
      {isError ? (
        <p className="text-dense text-text-light-gray">
          Planning could not be loaded. Try opening this section again.
        </p>
      ) : isLoading || !data ? (
        <p className="text-dense text-text-light-gray">Loading planning…</p>
      ) : (
        <>
          <SettingsCard title="Cycles">
            <SettingsToggle
              checked={data.cycles.enabled}
              description="Organize work into fixed two-week periods."
              disabled={!data.canManage || mutation.isPending}
              inputId="board-cycles-enabled"
              label="Enable cycles"
              onChange={() =>
                mutation.mutate({
                  action: "set_cycles",
                  enabled: !data.cycles.enabled,
                })
              }
            />
            {data.cycles.enabled && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-2 text-dense">
                <dt className="text-text-light-gray">Duration</dt>
                <dd className="text-white-black">2 weeks</dd>
                <dt className="text-text-light-gray">Current starts</dt>
                <dd className="text-white-black">
                  {data.cycles.current
                    ? formatDate(data.cycles.current.startDate)
                    : "Not scheduled"}
                </dd>
                <dt className="text-text-light-gray">Next cycle</dt>
                <dd className="text-white-black">
                  {data.cycles.next
                    ? cycleDateRange(data.cycles.next)
                    : "Not scheduled"}
                </dd>
              </dl>
            )}
          </SettingsCard>

          <SettingsCard title="Target date">
            {data.canManage ? (
              <input
                aria-label="Board target date"
                className={FIELD_CLASS}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const value = event.target.value;
                  setTargetDate(value);
                  mutation.mutate({
                    action: "set_target_date",
                    targetDate: value || null,
                  });
                }}
                type="date"
                value={targetDate}
              />
            ) : (
              <p className="px-2 text-dense text-white-black">
                {data.targetDate ? formatDate(data.targetDate) : "No target date"}
              </p>
            )}
            <p className="px-2 text-dense font-medium text-text-light-gray">
              The date this board is working toward.
            </p>
          </SettingsCard>

          <SettingsCard title="Milestones">
            {data.milestones.length === 0 ? (
              <p className="px-2 text-dense text-text-light-gray">
                No milestones yet.
              </p>
            ) : (
              <div className="flex flex-col">
                {data.milestones.map((milestone) => (
                  <div
                    className="flex min-h-[44px] items-center gap-3 border-b border-light-black-border-1 px-2 py-2"
                    key={milestone.id}
                  >
                    <input
                      aria-label={`Mark ${milestone.title} complete`}
                      checked={Boolean(milestone.completedAt)}
                      className="accent-hypertasks-purple"
                      disabled={!data.canManage || mutation.isPending}
                      onChange={(event) =>
                        mutation.mutate({
                          action: "toggle_milestone",
                          completed: event.target.checked,
                          milestoneId: milestone.id,
                        })
                      }
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-dense font-medium text-white-black ${
                          milestone.completedAt ? "line-through opacity-60" : ""
                        }`}
                      >
                        {milestone.title}
                      </p>
                      <p className="text-meta text-text-light-gray">
                        {formatDate(milestone.targetDate)}
                      </p>
                    </div>
                    {data.canManage && (
                      <button
                        className="shrink-0 px-2 py-1 text-meta text-text-light-gray hover:text-white-black focus-visible:outline-none"
                        disabled={mutation.isPending}
                        onClick={() => setMilestoneToRemove(milestone)}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {data.canManage && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!milestoneTitle.trim() || !milestoneDate) return;
                  mutation.mutate(
                    {
                      action: "create_milestone",
                      targetDate: milestoneDate,
                      title: milestoneTitle,
                    },
                    {
                      onSuccess: () => {
                        setMilestoneDate("");
                        setMilestoneTitle("");
                      },
                    },
                  );
                }}
              >
                <input
                  aria-label="Milestone title"
                  className={FIELD_CLASS}
                  maxLength={120}
                  onChange={(event) => setMilestoneTitle(event.target.value)}
                  placeholder="Milestone name"
                  value={milestoneTitle}
                />
                <div className="flex items-center gap-3">
                  <input
                    aria-label="Milestone target date"
                    className={FIELD_CLASS}
                    onChange={(event) => setMilestoneDate(event.target.value)}
                    type="date"
                    value={milestoneDate}
                  />
                  <button
                    className="shrink-0 px-2 py-2 text-dense font-semibold text-white-black hover:text-text-light-gray focus-visible:outline-none disabled:opacity-50"
                    disabled={
                      mutation.isPending || !milestoneTitle.trim() || !milestoneDate
                    }
                    type="submit"
                  >
                    Add milestone
                  </button>
                </div>
              </form>
            )}
          </SettingsCard>

          <SettingsCard title="Health updates">
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!message.trim()) return;
                mutation.mutate(
                  { action: "post_status", health, message },
                  { onSuccess: () => setMessage("") },
                );
              }}
            >
              <select
                aria-label="Project health"
                className={FIELD_CLASS}
                onChange={(event) =>
                  setHealth(event.target.value as ProjectHealthValue)
                }
                value={health}
              >
                {PROJECT_HEALTH_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_HEALTH_LABELS[value]}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Health update"
                className={`${FIELD_CLASS} min-h-[88px] resize-y`}
                maxLength={2000}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="What changed, and what needs attention?"
                value={message}
              />
              <button
                className="self-start px-2 py-2 text-dense font-semibold text-white-black hover:text-text-light-gray focus-visible:outline-none disabled:opacity-50"
                disabled={mutation.isPending || !message.trim()}
                type="submit"
              >
                Post update
              </button>
            </form>

            {data.statusUpdates.length === 0 ? (
              <p className="px-2 text-dense text-text-light-gray">
                No health updates yet.
              </p>
            ) : (
              <div className="flex flex-col">
                {data.statusUpdates.map((update) => (
                  <article
                    className="flex flex-col gap-1 border-b border-light-black-border-1 px-2 py-3"
                    key={update.id}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 text-meta text-text-light-gray">
                      <strong className="font-semibold text-white-black">
                        {PROJECT_HEALTH_LABELS[update.health]}
                      </strong>
                      <span>{update.author.displayName ?? "Member"}</span>
                      <time dateTime={update.createdAt}>
                        {formatTimestamp(update.createdAt)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-dense text-white-black">
                      {update.message}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </SettingsCard>
          {milestoneToRemove && (
            <ConfirmDialog
              confirmLabel="Remove milestone"
              footerVerb="remove"
              id="remove-project-milestone"
              loading={mutation.isPending}
              loadingLabel="Removing milestone…"
              message={
                <span>
                  Remove <strong>{milestoneToRemove.title}</strong>?
                </span>
              }
              onCancel={() => setMilestoneToRemove(null)}
              onConfirm={() =>
                mutation.mutate(
                  {
                    action: "delete_milestone",
                    milestoneId: milestoneToRemove.id,
                  },
                  { onSuccess: () => setMilestoneToRemove(null) },
                )
              }
            />
          )}
        </>
      )}
    </SettingsSectionShell>
  );
}
