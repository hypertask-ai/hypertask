"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import AiUsageBar, {
  type MemberAiUsage,
  type PersonalAiUsageData,
} from "./AiUsageBar";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const OWNER_GATE_MESSAGE = "Only the team owner can view usage by member.";

const MemberUsageSection = () => {
  const { teamId } = useSettingsTeam();
  const [data, setData] = useState<PersonalAiUsageData | null>(null);
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

    setData(null);
    setError(null);
    setLoading(true);
    axios
      .get<PersonalAiUsageData>("/api/settings/ai-usage/personal", {
        params: { teamId },
      })
      .then((response) => {
        if (!cancelled) setData(response.data);
      })
      .catch((requestError) => {
        console.error("Could not load member AI usage:", requestError);
        if (!cancelled) {
          setData(null);
          setError(
            axios.isAxiosError(requestError) &&
              requestError.response?.status === 403
              ? OWNER_GATE_MESSAGE
              : "Member AI usage is currently unavailable.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [teamId]);

  if (!teamId) {
    return (
      <MemberUsageShell>
        Open a team board before viewing usage by member.
      </MemberUsageShell>
    );
  }

  if (loading) {
    return <MemberUsageShell>Loading member AI usage</MemberUsageShell>;
  }

  if (error) {
    return <MemberUsageShell>{error}</MemberUsageShell>;
  }

  if (data?.fundingSource === "customer") {
    return (
      <MemberUsageShell>
        Usage is billed to this team&apos;s own AI Gateway key.
      </MemberUsageShell>
    );
  }

  if (!data?.memberUsage) {
    return <MemberUsageShell>{OWNER_GATE_MESSAGE}</MemberUsageShell>;
  }

  return (
    <SettingsSectionShell title="Usage by member">
      <SettingsCard title="This month">
        <div className="flex flex-col gap-1">
          {data.memberUsage.map((member) => (
            <MemberUsageRow
              key={member.userId ?? member.displayName}
              member={member}
            />
          ))}
        </div>
      </SettingsCard>
    </SettingsSectionShell>
  );
};

const MemberUsageShell = ({ children }: { children: React.ReactNode }) => (
  <SettingsSectionShell title="Usage by member">
    <SettingsCard title="This month">
      <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
        {children}
      </p>
    </SettingsCard>
  </SettingsSectionShell>
);

const MemberUsageRow = ({ member }: { member: MemberAiUsage }) => (
  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(88px,1.4fr)_90px] items-center gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active">
    <span className="truncate text-dense font-semibold text-white-black">
      {member.displayName}
    </span>
    <AiUsageBar className="h-1.5" sharePct={member.sharePct} />
    <span className="text-right text-dense font-medium text-text-light-gray">
      {member.sharePct}% of share
    </span>
  </div>
);

export default MemberUsageSection;
