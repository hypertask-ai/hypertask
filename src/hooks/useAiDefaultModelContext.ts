import { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG } from "@/lib/flags/definitions/htpr-7634-openai-only-default";
import { useTeamAiProviders } from "@/hooks/useTeamAiProviders";
import { useFlag } from "@/hooks/useFlag";

export function useAiDefaultModelContext(teamId: string | null | undefined) {
  const enabled = useFlag(HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG);
  const { defaultModelContext } = useTeamAiProviders(enabled ? teamId : null);
  return enabled ? defaultModelContext : undefined;
}
