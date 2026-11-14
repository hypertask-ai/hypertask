"use client";

import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { keepAiChatClosedAtom } from "@/store";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG } from "@/lib/flags/keys";
import { AI_CHAT_AUTO_OPEN_KEYS } from "@/lib/aiChat/autoOpenPreferences";
import { useAiChatOpenPreferences } from "./useAiChatOpenPreferences";

export function useKeepChatClosed() {
  const legacyFlagEnabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const legacyFlagReady = useFlagReady(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const legacySaved = useRecoilValue(keepAiChatClosedAtom);
  const preferences = useAiChatOpenPreferences();
  if (preferences.enabled) {
    const everyAutoOpenOff = AI_CHAT_AUTO_OPEN_KEYS.every((key) => !preferences.values[key]);
    return { keepChatClosed: everyAutoOpenOff, ready: preferences.ready };
  }
  return { keepChatClosed: legacyFlagEnabled && legacySaved, ready: !legacySaved || legacyFlagReady };
}
