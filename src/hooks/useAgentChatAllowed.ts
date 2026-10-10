"use client";

import { useContext } from "react";
import { FeatureFlagsContext } from "@/hooks/featureFlagsContext";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG } from "@/lib/flags/keys";

/**
 * HTPR-7070: the one client check for Agent Chat entry points. Hidden until the
 * flag values have loaded. After that it is allowed when the owner-only flag is
 * off, or when it is on and the server-verified owner capability is true. The
 * server routes enforce the same rule. Kept out of "@/hooks/useFlag" so tests
 * that mock that module do not lose it.
 */
export function useAgentChatAllowed(): boolean {
  const { values, seeded } = useContext(FeatureFlagsContext);
  const hydrated = useHydrated();
  const loaded = (seeded || hydrated) && Object.hasOwn(values, HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG);
  if (!loaded) return false;
  return values[HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG] !== true || values.__featureFlagOwner === true;
}
