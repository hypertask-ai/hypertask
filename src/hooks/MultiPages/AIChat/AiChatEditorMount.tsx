"use client";
import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import useTiptapForAI from "./useAiTiptap";

// The ONLY module on the ChatProvider path that statically imports tiptap.
// ChatProvider wraps every route, so building the chat editor inline put the
// whole ProseMirror/tiptap stack (~250 KB) in the initial chunk of every page
// even with the chat closed. Isolating the useEditor() call here lets
// AI_Agent_Chat_Context load it through next/dynamic (HTPR-4508).
const AiChatEditorMount = ({
  contextCallback,
  projectId,
  onEditor,
}: {
  contextCallback: (node: any) => void;
  projectId?: number;
  onEditor: (editor: Editor | null) => void;
}) => {
  const { editor } = useTiptapForAI({ contextCallback, projectId });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  return null;
};

export default AiChatEditorMount;
