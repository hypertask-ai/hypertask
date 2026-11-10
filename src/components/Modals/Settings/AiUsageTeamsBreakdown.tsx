"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";
import { allowanceBarColor, featureLabel, formatResetDate, type AiUsageData } from "./AiUsageSection";

type TeamTarget = { projectId?: number; teamId: string; teamName: string };
export type TeamAiUsageBreakdownProps = Record<string, never>;

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-2 text-dense font-medium text-text-light-gray">{children}</p>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="min-w-0 flex-1 truncate text-dense font-semibold text-white-black">{label}</span>
    <span className="shrink-0 text-right text-dense font-medium text-text-light-gray">{value}</span>
  </div>
);

const UsageGroup = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <div className="flex flex-col gap-1">
    <p className="px-2 pt-2 text-meta font-semibold uppercase tracking-wide text-text-light-gray">{title}</p>
    {children}
  </div>
);
const TeamAiUsageCard = ({ target }: { target: TeamTarget }) => {
  const [data, setData] = useState<AiUsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { projectId, teamId } = target;

  useEffect(() => {
    let cancelled = false;
    axios
      .get<AiUsageData>("/api/settings/ai-usage", { params: { teamId, projectId } })
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
  const percentGroups = data
    ? [
        { rows: data.features.map((row) => ({ ...row, label: featureLabel(row.label) })), title: "By feature" },
        { rows: data.boards, title: "Most active boards" },
        { rows: members, title: "By member" },
      ]
    : [];
  const pct = allowance ? Math.min(allowance.pct, 100) : 0;

  return (
    <SettingsCard title={target.teamName}>
      {!error && data && allowance ? null : (
        <Note>
          {error ?? data?.usageMessage ?? (data ? "Monthly AI allowance is currently unavailable." : "Loading AI usage")}
        </Note>
      )}

      {!error && data && allowance ? (
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-[32px] font-semibold leading-none text-white-black">{allowance.pct}%</span>
              <span className="pb-0.5 text-dense font-medium text-text-light-gray">used this month</span>
            </div>
            <div
              aria-label={`${allowance.pct}% of monthly AI allowance used`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={pct}
              className="mt-4 h-2 w-full overflow-hidden rounded-full bg-hover-active"
              role="progressbar"
            >
              <div
                className={`h-full rounded-full transition-[width] ${allowanceBarColor(allowance.pct, allowance.capped)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-3 text-dense font-medium text-text-light-gray">
              Resets on {formatResetDate(allowance.resetsOn)}
              {allowance.projectedPct !== null ? ` · on track to use ~${allowance.projectedPct}% this month` : ""}
            </p>
          </div>

          {data.models.length > 0 ? (
            <UsageGroup title="By model">
              {data.models.map((row, index) => (
                <Row key={`${row.label}-${index}`} label={row.label} value={row.onYourKey ? "on your key" : `${row.pct ?? 0}%`} />
              ))}
            </UsageGroup>
          ) : null}

          {percentGroups.map(({ rows, title }) =>
            rows.length > 0 ? (
              <UsageGroup key={title} title={title}>
                {rows.map((row, index) => (
                  <Row key={`${row.label}-${index}`} label={row.label} value={`${row.pct}%`} />
                ))}
              </UsageGroup>
            ) : null,
          )}
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
        teams.map((target) => <TeamAiUsageCard key={target.teamId} target={target} />)
      ) : (
        <SettingsCard title="Teams">
          <Note>{error ?? (teams ? "Open a team board before viewing AI usage." : "Loading AI usage")}</Note>
        </SettingsCard>
      )}
    </SettingsSectionShell>
  );
};

export default TeamAiUsageBreakdown;
