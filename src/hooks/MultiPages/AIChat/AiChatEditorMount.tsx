"use client";
import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import useTiptapForAI from "./useAiTiptap";

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
