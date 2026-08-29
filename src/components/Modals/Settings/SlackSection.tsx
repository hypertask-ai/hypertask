"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import SettingsCard from "./SettingsCard";
import {
  BillingActionRow,
  settingsActionButtonClass,
} from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

type SlackInstallResponse = {
  install: {
    defaultProjectId: number | null;
    slackTeamId: string;
    slackTeamName: string;
  } | null;
};

const SlackSection = () => {
  const { projects, teamId } = useSettingsTeam();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingDefaultProject, setSavingDefaultProject] = useState(false);
  const queryKey = ["slackInstallation", teamId];
  const installQuery = useQuery<SlackInstallResponse>({
    queryKey,
    enabled: Boolean(teamId),
    queryFn: async () => {
      const response = await fetch(
        `/api/slack/installation?teamId=${encodeURIComponent(teamId ?? "")}`,
      );
      if (!response.ok) throw new Error("Could not load the Slack connection");
      return response.json() as Promise<SlackInstallResponse>;
    },
    refetchOnWindowFocus: false,
  });

  const disconnect = async () => {
    if (!teamId) return;
    setDisconnecting(true);
    try {
      const response = await fetch("/api/slack/installation", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) throw new Error("Could not disconnect Slack");
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Slack disconnected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect Slack");
    } finally {
      setDisconnecting(false);
    }
  };

  const install = installQuery.data?.install ?? null;
  const oauthError = searchParams?.get("slack_error");
  const boards = useMemo(
    () =>
      projects
        .filter((project) => project.teamId === teamId)
        .sort((a, b) =>
          (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? ""),
        ),
    [projects, teamId],
  );

  const updateDefaultProject = async (value: string) => {
    if (!teamId || !install) return;
    setSavingDefaultProject(true);
    try {
      const response = await fetch("/api/slack/installation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          defaultProjectId: value ? Number(value) : null,
        }),
      });
      if (!response.ok) throw new Error("Could not update the default project");
      const data = (await response.json()) as SlackInstallResponse;
      queryClient.setQueryData(queryKey, data);
      toast.success("Default project updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the default project",
      );
    } finally {
      setSavingDefaultProject(false);
    }
  };

  return (
    <SettingsSectionShell title="Slack">
      <SettingsCard title="Slack tasks and summaries">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Mention Hypertask to create a ticket from a full Slack thread. Follow-up
          discussion is summarized after 30 quiet minutes.
        </p>
        <BillingActionRow
          label="Slack workspace"
          action={
            installQuery.isLoading ? (
              <span className="text-dense font-medium text-text-light-gray">
                Loading
              </span>
            ) : install ? (
              <div className="flex items-center gap-3">
                <span className="text-dense font-medium text-text-light-gray">
                  {install.slackTeamName}
                </span>
                <button
                  className={settingsActionButtonClass}
                  disabled={disconnecting}
                  onClick={disconnect}
                  type="button"
                >
                  {disconnecting ? "Disconnecting" : "Disconnect"}
                </button>
              </div>
            ) : (
              <a
                aria-disabled={!teamId}
                className={`${settingsActionButtonClass} ${
                  teamId ? "" : "pointer-events-none text-text-light-gray"
                }`}
                href={
                  teamId
                    ? `/api/slack/install?teamId=${encodeURIComponent(teamId)}`
                    : undefined
                }
              >
                Connect Slack
              </a>
            )
          }
        />
        {install && (
          <BillingActionRow
            label="Default project"
            action={
              <div className="relative w-[230px]">
                <select
                  aria-label="Default Slack project"
                  className="w-full appearance-none rounded-[4px] bg-active-modal-element px-2 py-1 pr-8 text-dense leading-normal text-white-black shadow-[0_6px_20px_rgba(0,0,0,0.22)] outline-none transition-colors hover:bg-hoverCardBackground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingDefaultProject}
                  onChange={(event) => updateDefaultProject(event.target.value)}
                  value={install.defaultProjectId ?? ""}
                >
                  <option value="">Select a project</option>
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.title ?? board.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-light-gray"
                  size={16}
                  strokeWidth={1.75}
                />
              </div>
            }
          />
        )}
        {(installQuery.error || oauthError) && (
          <p className="px-2 text-dense font-medium text-red-400">
            {installQuery.error instanceof Error
              ? installQuery.error.message
              : "Slack could not be connected. Please try again."}
          </p>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default SlackSection;
