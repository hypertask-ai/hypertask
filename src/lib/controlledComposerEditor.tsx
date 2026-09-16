import { EditorContent, type Editor } from "@tiptap/react";
import useTiptapForAI from "@/hooks/MultiPages/AIChat/useAiTiptap";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";

// Same useTiptapForAI editor as AI chat. Mentions and slash commands stay
// off because those post to the AI chat thread, not this agent.
export function ControlledComposerEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  editorRef,
  onEditor,
}: {
  value: string;
  onChange: (value: string, cursor: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  ariaLabel: string;
  editorRef?: RefObject<Editor | null>;
  onEditor: (editor: Editor | null) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;

  const { editor } = useTiptapForAI({
    contextCallback: () => {},
    skipChatCommands: true,
    placeholder,
    ariaLabel,
    onUpdate: (text, cursor) => onChangeRef.current(text, cursor),
    onKeyDown: (event) => onKeyDownRef.current(event),
  });

  useEffect(() => {
    onEditor(editor);
    if (editorRef) editorRef.current = editor;
    return () => {
      onEditor(null);
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef, onEditor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.getText() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="h-[21px]" />;
  return <EditorContent editor={editor} />;
}
