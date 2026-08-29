"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import AiUsageBar, { type PersonalAiUsageData } from "./AiUsageBar";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsNavigation } from "./settingsNavigation";

type PersonalAiUsageTeam = PersonalAiUsageData & {
  teamId: string;
  teamName: string;
  resetsOn: string;
};

type PersonalAiUsageAllResponse = {
  teams: PersonalAiUsageTeam[];
};

const MyAiUsageSection = () => {
  const { setSettingsSection } = useSettingsNavigation();
  const [data, setData] = useState<PersonalAiUsageAllResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get<PersonalAiUsageAllResponse>(
          "/api/settings/ai-usage/personal/all",
        );
        if (!cancelled) {
          setData({
            teams: [...response.data.teams].sort(
              (a, b) =>
                b.userSharePct - a.userSharePct ||
                a.teamName.localeCompare(b.teamName),
            ),
          });
        }
      } catch (requestError) {
        console.error("Could not load personal AI usage:", requestError);
        if (!cancelled) {
          setData(null);
          setError("AI usage is currently unavailable.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <SettingsSectionShell title="AI usage">
        <SettingsCard title="Teams">
          <EmptyState>Loading AI usage</EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  if (error || !data) {
    return (
      <SettingsSectionShell title="AI usage">
        <SettingsCard title="Teams">
          <EmptyState>{error ?? "AI usage is currently unavailable."}</EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  if (data.teams.length === 0) {
    return (
      <SettingsSectionShell title="AI usage">
        <SettingsCard title="Teams">
          <EmptyState>You do not belong to any teams.</EmptyState>
        </SettingsCard>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell title="AI usage">
      {data.teams.map((team) => (
        <SettingsCard key={team.teamId} title={team.teamName}>
          <PersonalAiUsageBar data={team} />
        </SettingsCard>
      ))}

      <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
        More AI usage detail, including team totals, usage by member, and models,
        lives in{" "}
        <button
          className="rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
          onClick={() => setSettingsSection("ai-usage")}
          type="button"
        >
          Team settings →
        </button>
        {". Only the team owner or a board admin can view AI usage."}
      </p>
    </SettingsSectionShell>
  );
};

const PersonalAiUsageBar = ({
  data,
}: {
  data: PersonalAiUsageData & { resetsOn: string };
}) => {
  if (data.fundingSource === "customer") {
    return (
      <div className="flex min-h-[124px] flex-col justify-center rounded-[5px] bg-cardBackground px-4 py-4">
        <p className="text-[15px] font-semibold text-white-black">
          Usage is billed to this team&apos;s own AI Gateway key.
        </p>
      </div>
    );
  }

  const resetsOn = new Date(`${data.resetsOn}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { day: "numeric", month: "short", timeZone: "UTC" },
  );
  const isSoloTeam = data.memberCount === 1;
  const sharePct = Math.max(data.userSharePct, 0);
  const personalLabel = isSoloTeam
    ? `${Math.min(sharePct, 100)}% of your monthly AI usage used`
    : sharePct > 100
      ? `${sharePct}% of your share - borrowing from the team's unused pool`
      : `${sharePct}% of your share used`;

  return (
    <div className="flex min-h-[124px] flex-col justify-center gap-5 rounded-[5px] bg-cardBackground px-4 py-4">
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold text-white-black">
          {personalLabel}
        </p>
        <AiUsageBar className="h-3" sharePct={sharePct} />
        <p className="text-dense font-medium text-text-light-gray">
          Resets {resetsOn}
        </p>
      </div>
    </div>
  );
};

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
    {children}
  </p>
);

export default MyAiUsageSection;
