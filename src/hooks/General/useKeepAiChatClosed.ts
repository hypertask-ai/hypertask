import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { keepAiChatClosedAtom } from "@/store";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG } from "@/lib/flags/definitions/htpr-7530-keep-ai-chat-closed";

export function useKeepAiChatClosed() {
  const enabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const ready = useFlagReady(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const keepAiChatClosed = useRecoilValue(keepAiChatClosedAtom);
  return { keepAiChatClosed: enabled && keepAiChatClosed, ready: !keepAiChatClosed || ready };
}
