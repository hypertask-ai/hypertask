import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import {
  AI_PROVIDERS,
  enabledProvidersForTeam,
  type TAiProviderKey,
} from "@/lib/aiProviders";

export type TeamAiProviderRow = {
  key: TAiProviderKey;
  label: string;
  chinaHosted: boolean;
  gdprNote?: string;
  enabled: boolean;
};

type TeamAiProvidersResponse = {
  gdprSafeMode: boolean;
  providers: TeamAiProviderRow[];
};

const defaultProviders: TeamAiProviderRow[] = AI_PROVIDERS.map((provider) => ({
  key: provider.key,
  label: provider.label,
  chinaHosted: provider.chinaHosted,
  gdprNote: provider.gdprNote,
  enabled: provider.defaultEnabled,
}));

export const teamAiProvidersQueryKey = (teamId: string | null | undefined) => [
  "teamAiProviders",
  teamId ?? null,
];

export function useTeamAiProviders(teamId: string | null | undefined) {
  const query = useQuery<TeamAiProvidersResponse>({
    queryKey: teamAiProvidersQueryKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async () => {
      const { data } = await axios.get<TeamAiProvidersResponse>(
        "/api/teams/aiProviderSettings",
        { params: { teamId } },
      );
      return data;
    },
  });

  const providers = query.data?.providers ?? defaultProviders;

  return {
    enabledProviders: query.data
      ? providers
          .filter((provider) => provider.enabled)
          .map((provider) => provider.key)
      : enabledProvidersForTeam(undefined),
    isLoading: Boolean(teamId) && query.isLoading,
    gdprSafeMode: query.data?.gdprSafeMode ?? false,
    providers,
    refetch: query.refetch,
  };
}
