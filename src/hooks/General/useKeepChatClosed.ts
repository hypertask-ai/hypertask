"use client";

import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { keepAiChatClosedAtom } from "@/store";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG } from "@/lib/flags/keys";
import { HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG } from "@/lib/flags/definitions/htpr-9245-chat-waits-for-saved-switches";
import { AI_CHAT_AUTO_OPEN_KEYS } from "@/lib/aiChat/autoOpenPreferences";
import { useAiChatOpenPreferences } from "./useAiChatOpenPreferences";

export function useKeepChatClosed() {
  const legacyFlagEnabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const legacyFlagReady = useFlagReady(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const waitsForSavedSwitches = useFlag(HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG);
  const legacySaved = useRecoilValue(keepAiChatClosedAtom);
  const preferences = useAiChatOpenPreferences();
  if (preferences.enabled) {
    const everyAutoOpenOff = AI_CHAT_AUTO_OPEN_KEYS.every((key) => !preferences.values[key]);
    const answerReady = !waitsForSavedSwitches || preferences.savedReady !== false;
    return { keepChatClosed: everyAutoOpenOff, ready: preferences.ready && answerReady };
  }
  return { keepChatClosed: legacyFlagEnabled && legacySaved, ready: !legacySaved || legacyFlagReady };
}
