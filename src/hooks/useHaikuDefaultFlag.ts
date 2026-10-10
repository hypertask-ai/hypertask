import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import {
  HTPR_7038_HAIKU_DEFAULT_FLAG,
  HTPR_7075_BACKGROUND_CLAUDE_FLAG,
} from "@/lib/flags/keys";

// HTPR-7075: Claude 5.5 mode (Haiku 5.5 default, older Claude versions hidden)
// is on when either the Haiku default flag or the background Claude flag is on.
export function useHaikuDefaultFlag(): boolean {
  const haikuDefault = useFlag(HTPR_7038_HAIKU_DEFAULT_FLAG);
  const backgroundClaude = useFlag(HTPR_7075_BACKGROUND_CLAUDE_FLAG);
  return haikuDefault || backgroundClaude;
}

// Both flags arrive in the same flag payload, so the Haiku default flag
// standing in for "loaded" keeps older flag fixtures valid.
export function useHaikuDefaultFlagLoaded(): boolean {
  return useFlagLoaded(HTPR_7038_HAIKU_DEFAULT_FLAG);
}
