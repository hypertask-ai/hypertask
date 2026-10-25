import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6937_NEW_TASK_WINDOW_FLAG } from "@/lib/flags/keys";
import Highlight from "@tiptap/extension-highlight";
import OrderedList from "@tiptap/extension-ordered-list";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Extension, nodePasteRule, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { RedirectMode } from "@/models/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { getRandomElement } from "@/utils/helperFunctions/helperFunctions";
import globalConstants from "@/lib/constants";
const allowedCommentModes: RedirectMode[] = [
  "create-comment",
  "read-edit-comments",
];
import styles from "@/styles/tiptap.module.scss";
import Underline from "@tiptap/extension-underline";
import Gapcursor from "@tiptap/extension-gapcursor";

import { normalizeEditorHtml, shouldSyncDraft } from "./draftSync";
import SlashCommands from "./Extensions/SlashCommands/SlashCommands";
import Snippets from "./Extensions/Snippets/Snippets";
import Link from "@tiptap/extension-link";
import LazyEmoji from "./Extensions/LazyEmoji";
import { HTPR_6906_AUTOCAP_UNDO_FLAG, LOCAL_WRITING_ASSISTANCE_FLAG } from "@/lib/flags/keys";
import suggestion from "./suggestion";
import { createMentionData } from "./MentionData";
import { Figma } from "./Extensions/FigmaTiptap";
import { Loom } from "./Extensions/LoomTiptap";
import { ResizableMedia } from "./Extensions/resizableMedia";
import { uploadFilesViaApi } from "@/lib/storage/uploadViaApi";
import { Youtube } from "./Extensions/YoutubeTiptap";
import { HtmlBlock } from "./Extensions/HtmlBlock";
import { HypertaskPasteRule } from "./Extensions/Hypertask-Links";
import {
  focusTiptapEditor,
  registerTiptapEditor,
  unregisterTiptapEditor,
} from "@/lib/snippets";
import { ReplyBlockquote } from "./Extensions/ReplyBlockquote";
import { useFlag } from "@/hooks/useFlag";
import { withMentionBackspaceDeletion } from "./Extensions/DeleteMentionOnBackspace";
import { LinkableMention } from "./Extensions/LinkableMention";
import { SafeSplitBlock } from "./Extensions/SafeSplitBlock";
import { writingAssistanceEditorProps } from "./writingAssistance";
import { LocalWritingAssistance } from "./writingAssistance";

const defaultScrollMargin = 5;
const descriptionCaretTopGutter = 8;

const getTaskDetailStickyHeaderOffset = () => {
  if (typeof document === "undefined") return descriptionCaretTopGutter;

  const titleContainer = document.querySelector<HTMLElement>(
    '[data-title-container="task-detail"]'
  );

  return (
    (titleContainer?.getBoundingClientRect().height ?? 0) +
    descriptionCaretTopGutter
  );
};

const DisableEnter = Extension.create({
  addKeyboardShortcuts() {
    return {
      "Control-Enter": () => true,
      "Mod-Enter": () => true,
    };
  },
});
interface IProps {
  defaultContent?: string;
  mode: any;
  editorId?: string;
  createNewComment?: boolean;
  trackFocus?: boolean;
  mentionProjectId?: number | null;
  placeholder?: string;
}
const useTiptap = ({
  mode,
  editorId,
  defaultContent = "",
  createNewComment = false,
  trackFocus = true,
  mentionProjectId,
  placeholder,
}: IProps) => {
  const skillProjectIdRef = useRef(mentionProjectId);
  skillProjectIdRef.current = mentionProjectId;
  const isApple = useDeviceContext();
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const newTaskWindowFlag = useFlag(HTPR_6937_NEW_TASK_WINDOW_FLAG);
  let newTaskWindow = false;
  if (mode === "read-edit-description" && composeEnabled && newTaskWindowFlag) newTaskWindow = true;
  const localWritingAssistance = useFlag(LOCAL_WRITING_ASSISTANCE_FLAG);
  const localWritingAssistanceRef = useRef(localWritingAssistance);
  localWritingAssistanceRef.current = localWritingAssistance;
  const autocapUndo = useFlag(HTPR_6906_AUTOCAP_UNDO_FLAG);
  const autocapUndoRef = useRef(autocapUndo);
  if (autocapUndo) autocapUndoRef.current = true;
  else autocapUndoRef.current = false;
  const isMobileView = useContext(MobileViewContext);
  const editorRef = useRef<Editor | null>(null);
  const [initialContent] = useState(defaultContent);
  const editorProps = useMemo(() => {
    if (mode !== "read-edit-description") return writingAssistanceEditorProps;

    const stickyHeaderOffset = getTaskDetailStickyHeaderOffset();

    return {
      ...writingAssistanceEditorProps,
      scrollThreshold: {
        top: stickyHeaderOffset,
        right: 0,
        bottom: 0,
        left: 0,
      },
      scrollMargin: {
        top: stickyHeaderOffset,
        right: defaultScrollMargin,
        bottom: defaultScrollMargin,
        left: defaultScrollMargin,
      },
    };

  }, []);
  const extensions = useMemo(
    () => [
      Gapcursor,
      StarterKit.configure({
        link: false,
        underline: false,
        blockquote: false,
        orderedList: false,
        gapcursor: false,
      }),
      Loom,
      Figma,
      Youtube,
      HtmlBlock,
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
        placeholder:
          placeholder ??
          (allowedCommentModes.includes(mode)
            ? getRandomElement(
                globalConstants.CommentTips(isApple, createNewComment)
              )
            : isMobileView || newTaskWindow
              ? "Add a description…"
              : getRandomElement(globalConstants.DescriptionTips(isApple))),
        emptyEditorClass: `${styles.is_editor_empty}`,
        emptyNodeClass: "New Comment",
      }),
      Underline,

      SlashCommands(mode, editorId, () => skillProjectIdRef.current),
      Snippets,
      Link.extend({ inclusive: false }).configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: "_blank",
        },
      }),
      ReplyBlockquote,
      LazyEmoji.configure({
        enableEmoticons: true,
        suggestion: suggestion,
      }),
      ...withMentionBackspaceDeletion(
        LinkableMention.configure({
          HTMLAttributes: {
            class: "mention",
          },
          suggestion: createMentionData(mentionProjectId),
        })
      ),
      ResizableMedia.configure({
        uploadFn: async (file) => {
          try {
            const strings = await uploadFilesViaApi([file]);
            console.log("🚀 ~ uploadFn: ~ strings:", strings);
            return strings[0];
          } catch (error) {
            console.error("Upload failed:", error);
            throw error;
          }
        },
        onUploadStart: () => {
          console.log("Upload started");
          document.body.classList.add("editor-uploading");
        },
        onUploadEnd: () => {
          console.log("Upload ended");
          document.body.classList.remove("editor-uploading");
        },
      }),
      DisableEnter,
      SafeSplitBlock,
      HypertaskPasteRule,
      LocalWritingAssistance.configure({
        localCapitalizationEnabled: () => localWritingAssistanceRef.current,
        undoCapitalizationEnabled: () => autocapUndoRef.current,
      }),
    ],

    []
  );
  const editor = useEditor({
    extensions,
    content: initialContent,
    editorProps,
    immediatelyRender: false,
    onCreate: ({ editor }) => {
      editorRef.current = editor as Editor;
      if (trackFocus) registerTiptapEditor(mode, editor as Editor);
    },
    onFocus: ({ editor }) => {
      if (trackFocus) focusTiptapEditor(editor as Editor);
    },
    onDestroy: () => {
      const editor = editorRef.current;
      if (trackFocus && editor) unregisterTiptapEditor(mode, editor);
      editorRef.current = null;
    },
  });
  const userHasEditedRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const markEdited = () => {
      userHasEditedRef.current = true;
    };
    editor.on("update", markEdited);
    return () => {
      editor.off("update", markEdited);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const incoming = normalizeEditorHtml(defaultContent);
    const rendered = normalizeEditorHtml(editor.getHTML());
    if (!shouldSyncDraft(incoming, rendered, userHasEditedRef.current)) return;
    const caret = editor.isFocused ? editor.state.selection.from : null;
    editor.commands.setContent(defaultContent ?? "", { emitUpdate: false });
    if (caret !== null) {
      editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
    }
  }, [editor, defaultContent]);

  return {
    editor,
  };
};

export default useTiptap;
