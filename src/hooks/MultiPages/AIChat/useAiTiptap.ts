import Highlight from "@tiptap/extension-highlight";
import OrderedList from "@tiptap/extension-ordered-list";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Extension, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import styles from "@/styles/tiptap.module.scss";
import Underline from "@tiptap/extension-underline";
import Gapcursor from "@tiptap/extension-gapcursor";
import { createMentionData } from "@/components/RTE/Components/AI_Chat/MentionData";
import { LinkableMention } from "@/components/RTE/Extensions/LinkableMention";
import SlashCommands from "@/components/RTE/Extensions/SlashCommands/SlashCommands";
import { useContext, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { writingAssistanceEditorProps } from "@/components/RTE/writingAssistance";
import { LocalWritingAssistance } from "@/components/RTE/writingAssistance";
import { useFlag } from "@/hooks/useFlag";
import { LOCAL_WRITING_ASSISTANCE_FLAG } from "@/lib/flags/keys";

const DisableEnter = Extension.create({
  addKeyboardShortcuts() {
    return {
      "Control-Enter": () => true,
      "Mod-Enter": () => true,
    };
  },
});

const useTiptapForAI = ({
  contextCallback,
  projectId,
  skipChatCommands = false,
  placeholder,
  ariaLabel,
  onUpdate,
  onKeyDown,
}: {
  contextCallback: (node: any) => void;
  projectId?: number;
  skipChatCommands?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  onUpdate?: (text: string, cursor: number) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) => {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  const localWritingAssistance = useFlag(LOCAL_WRITING_ASSISTANCE_FLAG);
  const localWritingAssistanceRef = useRef(localWritingAssistance);
  localWritingAssistanceRef.current = localWritingAssistance;
  // There is no Ctrl key on a phone, so the desktop hint is noise there.
  // Read through a ref: the editor config is built once on mount, and the
  // placeholder is a function so it picks up the current value instead.
  const isMobileRef = useRef(false);
  isMobileRef.current = useContext(MobileViewContext);

  const extensions = [
    Gapcursor,
    StarterKit.configure({
      gapcursor: false,
      link: { autolink: false },
      orderedList: false,
      underline: false,
    }),
    TaskList.configure({
      HTMLAttributes: {
        class: "taskList",
      },
    }),
    TaskItem,
    OrderedList.configure({
      itemTypeName: "listItem",
      HTMLAttributes: {
        class: "numbered-list",
      },
    }),
    Highlight.configure({ multicolor: true }),
    Placeholder.configure({
      placeholder: () =>
        placeholderRef.current ??
        (isMobileRef.current
          ? `@ for context`
          : `Focus with CTRL + Q, @ for context`),
      emptyEditorClass: `${styles.is_editor_empty}`,
      emptyNodeClass: "New Comment",
    }),
    Underline.extend({ inclusive: false }),
    ...(skipChatCommands
      ? []
      : [
          LinkableMention.configure({
            HTMLAttributes: {
              class: "mention",
            },
            suggestion: createMentionData(
              contextCallback,
              () => projectIdRef.current
            ),
          }),
          SlashCommands("ai-chat"),
        ]),
    DisableEnter,
    LocalWritingAssistance.configure({
      localCapitalizationEnabled: () => localWritingAssistanceRef.current,
    }),
  ];

  const editor = useEditor({
    extensions,
    editorProps: {
      ...writingAssistanceEditorProps,
      attributes: {
        ...writingAssistanceEditorProps.attributes,
        ...(ariaLabel
          ? {
              "aria-label": ariaLabel,
              "aria-multiline": "true",
              role: "textbox",
            }
          : {}),
      },
      handleKeyDown: onKeyDown
        ? (_view, event) => {
            onKeyDownRef.current?.(
              event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>,
            );
            return event.defaultPrevented;
          }
        : undefined,
    },
    immediatelyRender: false,
    onUpdate: onUpdate
      ? ({ editor: next }: { editor: Editor }) => {
          const text = next.getText();
          const before = next.state.doc.textBetween(0, next.state.selection.from);
          onUpdateRef.current?.(text, before.length);
        }
      : undefined,
  });
  return {
    editor,
  };
};

export default useTiptapForAI;
