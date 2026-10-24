import type { Editor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";
import { bindAiChatDraft } from "@/lib/aiChatDraftStore";

export function useAiChatDraft(
  editor: Editor | null,
  userId: number | undefined,
  sessionId: string | null | undefined,
  enabled: boolean,
  agentId?: string | null,
) {
  const drafts = useRef(new Map<string, string>());
  const previousBinding = useRef<{ key: string; editor: Editor } | null>(null);
  const submission = useRef<(() => () => void) | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !editor || userId === undefined || !sessionId) return;
    const binding = bindAiChatDraft(editor, userId, sessionId, drafts, previousBinding, agentId);
    submission.current = binding.captureSubmission;
    return () => {
      submission.current = null;
      binding.cleanup();
    };
  }, [editor, userId, sessionId, enabled, agentId]);

  return () => submission.current?.();
}
