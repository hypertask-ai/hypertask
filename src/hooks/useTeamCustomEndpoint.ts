import { resolveHaikuModelId } from "@/lib/aiModelOptions";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";

type TeamByokKeyRow = {
  provider: string;
  enabled: boolean;
  hasSecret: boolean;
  baseUrl?: string | null;
  gdprCompliant?: boolean;
  modelId?: string | null;
};

type TeamByokKeysResponse = {
  gdprSafeMode?: boolean;
  keys: TeamByokKeyRow[];
};

export const teamByokKeysQueryKey = (teamId: string | null | undefined) => [
  "teamByokKeys",
  teamId ?? null,
];

export function useTeamCustomEndpoint(teamId: string | null | undefined) {
  const query = useQuery<TeamByokKeysResponse>({
    queryKey: teamByokKeysQueryKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async () => {
      const { data } = await axios.get<TeamByokKeysResponse>(
        "/api/teams/byokKeys",
        { params: { teamId } }
      );
      return data;
    },
  });
  const custom = query.data?.keys.find((row) => row.provider === "custom");
  const haikuDefaultEnabled = true;
  const haiku55Enabled = true;
  const modelId = haikuDefaultEnabled || haiku55Enabled
    ? resolveHaikuModelId(custom?.modelId?.trim() || "", true) || null
    : custom?.modelId?.trim() || null;

  return {
    configured: Boolean(
      custom?.enabled &&
        custom.hasSecret &&
        custom.baseUrl?.trim() &&
        custom.modelId?.trim() &&
        (!query.data?.gdprSafeMode || custom.gdprCompliant)
    ),
    isLoading: Boolean(teamId) && query.isLoading,
    modelId,
  };
}
