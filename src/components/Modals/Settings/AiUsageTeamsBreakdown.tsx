"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";
import {
  EmptyState,
  ModelRow,
  PercentageUsageRow,
  allowanceBarColor,
  featureLabel,
  formatResetDate,
  type AiUsageData,
} from "./AiUsageSection";

type TeamTarget = { projectId?: number; teamId: string; teamName: string };

const UsageGroup = ({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) => (
  <div className="flex flex-col gap-1">
    <p className="px-2 pt-2 text-meta font-semibold uppercase tracking-wide text-text-light-gray">
      {title}
    </p>
    {children}
  </div>
);

const TeamAiUsageCard = ({ target }: { target: TeamTarget }) => {
  const [data, setData] = useState<AiUsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = target.projectId;
  const { teamId } = target;

  useEffect(() => {
    let cancelled = false;

    axios
      .get<AiUsageData>("/api/settings/ai-usage", {
        params: { teamId, projectId },
      })
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((requestError) => {
        console.error(requestError);
        if (!cancelled) setError("AI usage is currently unavailable.");
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, teamId]);

  const members = data?.members ?? [];
  const allowance = data?.allowance ?? null;

  return (
    <SettingsCard title={target.teamName}>
      {!error && data && allowance ? null : (
        <EmptyState>
          {error ??
            data?.usageMessage ??
            (data
              ? "Monthly AI allowance is currently unavailable."
              : "Loading AI usage")}
        </EmptyState>
      )}

      {!error && data && allowance ? (
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-[32px] font-semibold leading-none text-white-black">
                {allowance.pct}%
              </span>
              <span className="pb-0.5 text-dense font-medium text-text-light-gray">
                used this month
              </span>
            </div>
            <div
              aria-label={`${allowance.pct}% of monthly AI allowance used`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.min(allowance.pct, 100)}
              className="mt-4 h-2 w-full overflow-hidden rounded-full bg-hover-active"
              role="progressbar"
            >
              <div
                className={`h-full rounded-full transition-[width] ${allowanceBarColor(
                  allowance.pct,
                  allowance.capped,
                )}`}
                style={{ width: `${Math.min(allowance.pct, 100)}%` }}
              />
            </div>
            <p className="mt-3 text-dense font-medium text-text-light-gray">
              Resets on {formatResetDate(allowance.resetsOn)}
              {allowance.projectedPct !== null
                ? ` · on track to use ~${allowance.projectedPct}% this month`
                : ""}
            </p>
          </div>

          {data.models.length > 0 ? (
            <UsageGroup title="By model">
              {data.models.map((row, index) => (
                <ModelRow key={`${row.label}-${index}`} row={row} />
              ))}
            </UsageGroup>
          ) : null}

          {data.features.length > 0 ? (
            <UsageGroup title="By feature">
              {data.features.map((row, index) => (
                <PercentageUsageRow
                  key={`${row.label}-${index}`}
                  row={{ ...row, label: featureLabel(row.label) }}
                />
              ))}
            </UsageGroup>
          ) : null}

          {data.boards.length > 0 ? (
            <UsageGroup title="Most active boards">
              {data.boards.map((row, index) => (
                <PercentageUsageRow key={`${row.label}-${index}`} row={row} />
              ))}
            </UsageGroup>
          ) : null}

          {members.length > 0 ? (
            <UsageGroup title="By member">
              {members.map((row, index) => (
                <PercentageUsageRow key={`${row.label}-${index}`} row={row} />
              ))}
            </UsageGroup>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
};

const TeamAiUsageBreakdown = () => {
  const { teamId, project, team } = useSettingsTeam();
  const [teams, setTeams] = useState<TeamTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = project?.id;
  const teamName = team?.title;

  useEffect(() => {
    let cancelled = false;

    axios
      .get<{ teams: TeamTarget[] }>("/api/settings/ai-usage/owned-teams")
      .then((response) => {
        if (cancelled) return;
        const targets: TeamTarget[] = Array.isArray(response.data.teams)
          ? response.data.teams.map((owned) => ({ ...owned }))
          : [];
        if (teamId && !targets.some((target) => target.teamId === teamId)) {
          targets.push({ projectId, teamId, teamName: teamName ?? "This team" });
        }
        setTeams(targets);
      })
      .catch((requestError) => {
        console.error(requestError);
        if (!cancelled) {
          setTeams([]);
          setError("AI usage is currently unavailable.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, teamId, teamName]);

  return (
    <SettingsSectionShell title="AI Usage">
      {teams?.length ? (
        teams.map((target) => (
          <TeamAiUsageCard key={target.teamId} target={target} />
        ))
      ) : (
        <SettingsCard title="Teams">
          <EmptyState>
            {error ??
              (teams
                ? "Open a team board before viewing AI usage."
                : "Loading AI usage")}
          </EmptyState>
        </SettingsCard>
      )}
    </SettingsSectionShell>
  );
};

export default TeamAiUsageBreakdown;
