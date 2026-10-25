import Highlight from "@tiptap/extension-highlight";
import OrderedList from "@tiptap/extension-ordered-list";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Extension, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import styles from "@/styles/tiptap.module.scss";
import Underline from "@tiptap/extension-underline";
import Gapcursor from "@tiptap/extension-gapcursor";
import { createMentionData } from "@/components/RTE/Components/AI_Chat/MentionData";
import { LinkableMention } from "@/components/RTE/Extensions/LinkableMention";
import SlashCommands from "@/components/RTE/Extensions/SlashCommands/SlashCommands";
import { useContext, useRef } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { writingAssistanceEditorProps } from "@/components/RTE/writingAssistance";
import { LocalWritingAssistance } from "@/components/RTE/writingAssistance";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6906_AUTOCAP_UNDO_FLAG, LOCAL_WRITING_ASSISTANCE_FLAG } from "@/lib/flags/keys";
import { SafeSplitBlock } from "@/components/RTE/Extensions/SafeSplitBlock";

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
}: {
  contextCallback: (node: any) => void;
  projectId?: number;
}) => {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const localWritingAssistance = useFlag(LOCAL_WRITING_ASSISTANCE_FLAG);
  const localWritingAssistanceRef = useRef(localWritingAssistance);
  localWritingAssistanceRef.current = localWritingAssistance;
  const autocapUndo = useFlag(HTPR_6906_AUTOCAP_UNDO_FLAG);
  const autocapUndoRef = useRef(autocapUndo);
  if (autocapUndo) autocapUndoRef.current = true;
  else autocapUndoRef.current = false;
  const isMobileRef = useRef(false);
  isMobileRef.current = useContext(MobileViewContext);

  const editor = useEditor({
    extensions: [
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
          isMobileRef.current
            ? `@ for context`
            : `Focus with CTRL + Q, @ for context`,
        emptyEditorClass: `${styles.is_editor_empty}`,
        emptyNodeClass: "New Comment",
      }),
      Underline.extend({ inclusive: false }),
      LinkableMention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: createMentionData(
          contextCallback,
          () => projectIdRef.current
        ),
      }),
      SlashCommands("ai-chat", undefined, () => projectIdRef.current),
      DisableEnter,
      SafeSplitBlock,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => localWritingAssistanceRef.current,
        undoCapitalizationEnabled: () => autocapUndoRef.current,
      }),
    ],
    editorProps: writingAssistanceEditorProps,
    immediatelyRender: false,
  });
  return {
    editor,
  };
};

export default useTiptapForAI;
