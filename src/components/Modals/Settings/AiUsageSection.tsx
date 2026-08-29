"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsNavigation } from "./settingsNavigation";
import { useSettingsTeam } from "./useSettingsTeam";

type PercentageRow = {
  label: string;
  pct: number;
};

type ModelUsageRow = {
  label: string;
  onYourKey: boolean;
  pct: number | null;
};

type AiUsageData = {
  configured: boolean;
  fundingSource: "customer" | "managed" | "shared" | null;
  period: { endDate: string; startDate: string } | null;
  allowance: {
    budgetUsd: number;
    pct: number;
    capped: boolean;
    remainingUsd: number;
    resetsOn: string;
    projectedPct: number | null;
    usedUsd: number;
  } | null;
  includedWithHypertask: { usedUsd: number } | null;
  models: ModelUsageRow[];
  features: PercentageRow[];
  boards: PercentageRow[];
  tasks: PercentageRow[];
  agents: PercentageRow[];
  usageMessage: string | null;
};

const AiUsageSection = () => {
  const { teamId, project } = useSettingsTeam();
  const { setSettingsSection } = useSettingsNavigation();
  const [data, setData] = useState<AiUsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!teamId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get<AiUsageData>(
          "/api/settings/ai-usage",
          { params: { teamId, projectId: project?.id } },
        );
        if (!cancelled) {
          setData(response.data);
        }
      } catch (requestError) {
        console.error(requestError);
        if (!cancelled) {
          setData(null);
          setError(
            axios.isAxiosError(requestError) &&
              requestError.response?.status === 403
              ? "Only the team owner or a board admin can view AI usage."
              : "AI usage is currently unavailable.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamId, project?.id]);

  if (!teamId) {
    return (
      <SettingsSectionShell title="AI Usage">
        <SettingsCard title="Team">
          <EmptyState>Open a team board before viewing AI usage.</EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  if (loading) {
    return (
      <SettingsSectionShell title="AI Usage">
        <SettingsCard title="Gateway">
          <EmptyState>Loading AI Gateway usage</EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  if (error || !data) {
    return (
      <SettingsSectionShell title="AI Usage">
        <SettingsCard title="Gateway">
          <EmptyState>
            {error ?? "AI usage is currently unavailable."}
          </EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  if (!data.configured) {
    return (
      <SettingsSectionShell title="AI Usage">
        <SettingsCard title="Gateway">
          <EmptyState>
            {data.usageMessage ??
              "No AI Gateway key is configured for this team."}
          </EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell title="AI Usage">
      <SettingsCard
        title={
          data.fundingSource === "customer"
            ? "Customer AI key"
            : "Monthly AI allowance"
        }
      >
        {data.allowance ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-end gap-2">
                <span className="text-[32px] font-semibold leading-none text-white-black">
                  {data.allowance.pct}%
                </span>
                <span className="pb-0.5 text-dense font-medium text-text-light-gray">
                  used this month
                </span>
              </div>

              <div
                aria-label={`${data.allowance.pct}% of monthly AI allowance used`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.min(data.allowance.pct, 100)}
                className="mt-4 h-2 w-full overflow-hidden rounded-full bg-hover-active"
                role="progressbar"
              >
                <div
                  className={`h-full rounded-full transition-[width] ${allowanceBarColor(
                    data.allowance.pct,
                    data.allowance.capped,
                  )}`}
                  style={{ width: `${Math.min(data.allowance.pct, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-dense font-medium text-text-light-gray">
                {`$${data.allowance.usedUsd.toFixed(2)} used · $${data.allowance.remainingUsd.toFixed(2)} remaining of $${data.allowance.budgetUsd.toFixed(2)}`}
              </p>
              <p className="text-dense font-medium text-text-light-gray">
                Resets on {formatResetDate(data.allowance.resetsOn)}
                {data.allowance.projectedPct !== null
                  ? ` · on track to use ~${data.allowance.projectedPct}% this month`
                  : ""}
              </p>
              {data.includedWithHypertask ? (
                <p className="text-dense font-medium text-text-light-gray">
                  {`$${data.includedWithHypertask.usedUsd.toFixed(2)} Included with Hypertask · automatic features do not reduce your allowance`}
                </p>
              ) : null}
            </div>

            {data.allowance.capped ? (
              <div className="flex flex-col gap-2 rounded-[5px] bg-amber-500/10 px-3 py-3">
                <p className="text-dense font-semibold text-amber-200">
                  You’ve used this month’s included AI pool
                </p>
                <p className="text-dense font-medium leading-relaxed text-text-light-gray">
                  AI on Hypertask&apos;s key pauses until the monthly reset.
                  Upgrade or add your own AI key to continue now; usage on your
                  key is billed to you and is not counted here.
                </p>
                <button
                  className="w-fit rounded-[5px] px-2 py-1 text-dense font-semibold text-amber-200 transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
                  onClick={() => setSettingsSection("apiKeys")}
                  type="button"
                >
                  Review AI options →
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState>
            {data.usageMessage ??
              "Monthly AI allowance is currently unavailable."}
          </EmptyState>
        )}
      </SettingsCard>

      {data.models.length > 0 ? (
        <SettingsCard title="By model">
          <div className="flex flex-col gap-1">
            {data.models.map((row, index) => (
              <ModelRow key={`${row.label}-${index}`} row={row} />
            ))}
          </div>
        </SettingsCard>
      ) : null}

      {data.features.length > 0 ? (
        <SettingsCard title="By feature">
          <div className="flex flex-col gap-1">
            {data.features.map((row, index) => (
              <PercentageUsageRow
                key={`${row.label}-${index}`}
                row={{ ...row, label: featureLabel(row.label) }}
              />
            ))}
          </div>
        </SettingsCard>
      ) : null}

      {data.boards.length > 0 ? (
        <SettingsCard title="Most active boards">
          <div className="flex flex-col gap-1">
            {data.boards.map((row, index) => (
              <PercentageUsageRow key={`${row.label}-${index}`} row={row} />
            ))}
          </div>
        </SettingsCard>
      ) : null}

      {data.tasks.length > 0 ? (
        <SettingsCard title="Most active tickets">
          <div className="flex flex-col gap-1">
            {data.tasks.map((row, index) => (
              <PercentageUsageRow key={`${row.label}-${index}`} row={row} />
            ))}
          </div>
        </SettingsCard>
      ) : null}

      {data.agents.length > 0 ? (
        <SettingsCard title="Most active agents">
          <div className="flex flex-col gap-1">
            {data.agents.map((row, index) => (
              <PercentageUsageRow key={`${row.label}-${index}`} row={row} />
            ))}
          </div>
        </SettingsCard>
      ) : null}
    </SettingsSectionShell>
  );
};

// Raw AiUsage feature slugs -> human labels for the "By feature" breakdown.
const FEATURE_LABELS: Record<string, string> = {
  chat: "AI chat",
  summary: "Summaries",
  editor: "Editor",
  "task-writer": "Task writer",
  "hyper-mentioned": "@HyperAI",
  "custom-instructions": "Custom instructions",
  "onboarding-board": "Onboarding",
  "task-questions": "Question suggestions",
};
const featureLabel = (slug: string) => FEATURE_LABELS[slug] ?? slug;

// "2026-08-01" -> "Aug 1". Parsed as UTC so the day never shifts by timezone.
const formatResetDate = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
};

const allowanceBarColor = (pct: number, capped: boolean) => {
  if (capped) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-hypertasks-header-blue";
};

const ModelRow = ({ row }: { row: ModelUsageRow }) => (
  <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(72px,2fr)_84px] items-center gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="truncate text-dense font-semibold text-white-black">
      {row.label}
    </span>
    <div className="h-1.5 overflow-hidden rounded-full bg-active-modal-element">
      {row.pct !== null && !row.onYourKey ? (
        <div
          className="h-full rounded-full bg-hypertasks-purple"
          style={{ width: `${Math.min(row.pct, 100)}%` }}
        />
      ) : null}
    </div>
    <span className="whitespace-nowrap text-right text-dense font-medium text-text-light-gray">
      {row.onYourKey ? "on your key" : `${row.pct ?? 0}%`}
    </span>
  </div>
);

const PercentageUsageRow = ({ row }: { row: PercentageRow }) => (
  <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="min-w-0 flex-1 truncate text-dense font-semibold text-white-black">
      {row.label}
    </span>
    <span className="shrink-0 text-right text-dense font-medium text-text-light-gray">
      {row.pct}%
    </span>
  </div>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
    {children}
  </p>
);

export default AiUsageSection;
