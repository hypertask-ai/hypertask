import { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG } from "@/lib/flags/definitions/htpr-7634-openai-only-default";
import { useTeamAiProviders } from "@/hooks/useTeamAiProviders";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import {
  HTPR_7038_HAIKU_DEFAULT_FLAG,
  HTPR_7075_BACKGROUND_CLAUDE_FLAG,
} from "@/lib/flags/keys";

export function useHaikuDefaultFlag(): boolean {
  const haikuDefault = useFlag(HTPR_7038_HAIKU_DEFAULT_FLAG);
  const backgroundClaude = useFlag(HTPR_7075_BACKGROUND_CLAUDE_FLAG);
  return haikuDefault || backgroundClaude;
}

export function useHaikuDefaultFlagLoaded(): boolean {
  return useFlagLoaded(HTPR_7038_HAIKU_DEFAULT_FLAG);
}

export function useAiDefaultModelContext(teamId: string | null | undefined) {
  const enabled = useFlag(HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG);
  const { defaultModelContext } = useTeamAiProviders(enabled ? teamId : null);
  return enabled ? defaultModelContext : undefined;
}
