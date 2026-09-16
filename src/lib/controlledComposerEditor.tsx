import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import styles from "@/styles/tiptap.module.scss";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";

// Dedicated editor for Agent Chat. useTiptapForAI also mounts AI-chat
// mentions and slash commands, which send to the AI chat thread, not this one.
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
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        gapcursor: false,
        link: { autolink: false },
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
        emptyEditorClass: `${styles.is_editor_empty}`,
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        role: "textbox",
        class: "outline-none py-2 text-dense",
      },
      handleKeyDown: (_view, event) => {
        onKeyDownRef.current(
          event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>,
        );
        return event.defaultPrevented;
      },
    },
    onUpdate: ({ editor: next }) => {
      const text = next.getText();
      const before = next.state.doc.textBetween(0, next.state.selection.from);
      onChangeRef.current(text, before.length);
    },
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
