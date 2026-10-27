import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { keepAiChatClosedAtom } from "@/store";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG } from "@/lib/flags/keys";

export function useKeepAiChatClosed() {
  const manualChat = useFlag(HTPR_8088_MANUAL_CHAT_FLAG);
  const manualChatReady = useFlagReady(HTPR_8088_MANUAL_CHAT_FLAG);
  const enabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const ready = useFlagReady(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const keepAiChatClosed = useRecoilValue(keepAiChatClosedAtom);
  return { keepAiChatClosed: manualChat || (enabled && keepAiChatClosed), ready: manualChatReady && (!keepAiChatClosed || ready) };
}
