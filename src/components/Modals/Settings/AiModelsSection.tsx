"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { currentUserAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import {
  teamAiProvidersQueryKey,
  useTeamAiProviders,
  type TeamAiProviderRow,
} from "@/hooks/useTeamAiProviders";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

const AiModelsSection = () => {
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const { ownerAndMembers, team, teamId } = useSettingsTeam();
  const { gdprSafeMode, isLoading, providers } = useTeamAiProviders(teamId);
  const [rows, setRows] = useState(providers);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [savingSafeMode, setSavingSafeMode] = useState(false);

  useEffect(() => setRows(providers), [providers]);

  const canManage = Boolean(
    team &&
    currentUser &&
    ((currentUser.accountId &&
      team.googleAccountId === currentUser.accountId) ||
      ownerAndMembers.owner?.id === currentUser.id),
  );
  const showReadOnlyNotice = Boolean(
    teamId && team && currentUser && !canManage,
  );

  const updateProvider = async (
    provider: TeamAiProviderRow,
    enabled: boolean,
  ) => {
    if (!teamId || !canManage) return;

    const previousRows = rows;
    const nextRows = rows.map((row) =>
      row.key === provider.key ? { ...row, enabled } : row,
    );
    setRows(nextRows);
    queryClient.setQueryData(teamAiProvidersQueryKey(teamId), {
      gdprSafeMode,
      providers: nextRows,
    });
    setSavingProvider(provider.key);

    try {
      const { data } = await axios.post<{ providers: TeamAiProviderRow[] }>(
        "/api/teams/aiProviderSettings",
        { teamId, provider: provider.key, enabled },
      );
      setRows(data.providers);
      queryClient.setQueryData(teamAiProvidersQueryKey(teamId), data);
    } catch (error) {
      setRows(previousRows);
      queryClient.setQueryData(teamAiProvidersQueryKey(teamId), {
        gdprSafeMode,
        providers: previousRows,
      });
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not update AI provider");
    } finally {
      setSavingProvider(null);
    }
  };

  const updateGdprSafeMode = async (enabled: boolean) => {
    if (!teamId || !canManage) return;
    setSavingSafeMode(true);
    try {
      const { data } = await axios.post<{
        gdprSafeMode: boolean;
        providers: TeamAiProviderRow[];
      }>("/api/teams/aiProviderSettings", { teamId, gdprSafeMode: enabled });
      setRows(data.providers);
      queryClient.setQueryData(teamAiProvidersQueryKey(teamId), data);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not update GDPR safe mode");
    } finally {
      setSavingSafeMode(false);
    }
  };

  return (
    <SettingsSectionShell title="AI models">
      <SettingsCard title="GDPR safe mode">
        <div className="flex items-center justify-between gap-4 px-2 py-2">
          <p className="max-w-[620px] text-dense font-medium leading-relaxed text-text-light-gray">
            Only providers operating under EU/US data agreements are offered.
            China-based providers are hidden for everyone on this team.
          </p>
          <SettingsToggle
            checked={gdprSafeMode}
            disabled={!canManage || savingSafeMode}
            hideLabel
            inputId="settings-gdpr-safe-mode"
            label={`${gdprSafeMode ? "Disable" : "Enable"} GDPR safe mode`}
            onChange={() => updateGdprSafeMode(!gdprSafeMode)}
          />
        </div>
      </SettingsCard>
      <SettingsCard title="Providers">
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Choose which AI providers are available to your team.
        </p>
        {showReadOnlyNotice ? (
          <p className="px-2 pb-2 text-micro font-medium text-text-light-gray">
            Only the team owner can change this.
          </p>
        ) : null}

        {!teamId ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Open a team board before managing AI providers.
          </p>
        ) : isLoading ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading AI providers
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((provider) => (
              <div
                className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active"
                key={provider.key}
                title={
                  canManage
                    ? undefined
                    : "Only the team owner can change providers"
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="text-dense font-semibold text-white-black">
                    {provider.label}
                  </div>
                  <p className="mt-1 text-dense font-medium leading-snug text-text-light-gray">
                    {provider.gdprNote ??
                      (provider.enabled ? "Enabled" : "Disabled")}
                  </p>
                </div>
                <SettingsToggle
                  checked={provider.enabled}
                  disabled={!canManage || savingProvider !== null}
                  hideLabel
                  inputId={`settings-ai-provider-${provider.key}`}
                  label={`${provider.enabled ? "Disable" : "Enable"} ${
                    provider.label
                  }`}
                  onChange={() => updateProvider(provider, !provider.enabled)}
                />
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default AiModelsSection;
