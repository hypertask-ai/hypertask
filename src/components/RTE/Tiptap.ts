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
// import { TrailingNode } from "./Extensions/trailingNode";

import { normalizeEditorHtml, shouldSyncDraft } from "./draftSync";
import SlashCommands from "./Extensions/SlashCommands/SlashCommands";
import Snippets from "./Extensions/Snippets/Snippets";
import Link from "@tiptap/extension-link";
import Emoji, { emojis } from "@tiptap/extension-emoji";
import suggestion from "./suggestion";
import MentionData from "./MentionData";
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
import { withMentionBackspaceDeletion } from "./Extensions/DeleteMentionOnBackspace";
import { LinkableMention } from "./Extensions/LinkableMention";
import { writingAssistanceEditorProps } from "./writingAssistance";

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
  createNewComment?: boolean;
  trackFocus?: boolean;
  // Overrides the mode-derived random tip, for callers (e.g. the feedback
  // form) that need a fixed, specific placeholder instead.
  placeholder?: string;
}
const useTiptap = ({
  mode,
  defaultContent = "",
  createNewComment = false,
  trackFocus = true,
  placeholder,
}: IProps) => {
  const isApple = useDeviceContext();
  // A phone has no CTRL key, so the "CTRL+J for Ai" tip is dead copy there
  // (HTPR-5517). Mobile descriptions get a plain placeholder instead.
  const isMobileView = useContext(MobileViewContext);
  // Tiptap's onDestroy hands back no editor, so keep the instance from onCreate
  // to unregister the exact editor that died, not whoever holds `mode` now.
  const editorRef = useRef<Editor | null>(null);
  // Capture the initial content once. Passing a changing `content` to useEditor
  // makes it call setOptions on re-render, which reconfigures the ProseMirror
  // plugins and destroys any open suggestion popup. The content prop changes
  // while editing (draft autosave updates the draft query that feeds it), so we
  // freeze the value the editor was created with. Callers only render this editor
  // once real content is available, and content updates flow through the editor
  // itself after mount, so freezing the initial value is safe.
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
    // mode is fixed for each editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Memoize the extensions so their instances are stable across renders.
  // Tiptap v3's useEditor compares extensions by reference and, when any
  // instance differs, calls setOptions which reconfigures every ProseMirror
  // plugin (destroying and recreating their plugin views). Building this array
  // inline on each render created fresh instances every time (StarterKit.configure,
  // SlashCommands(mode), Link.configure, ... all return new objects), so any
  // re-render tore down an open suggestion popup. That is why the slash "/" and
  // @ mention menus flashed then vanished the first time (opening them triggers a
  // re-render). A stable array keeps the plugins mounted and the menus open.
  const extensions = useMemo(
    () => [
      Gapcursor,
      // v3 StarterKit now bundles link/underline/blockquote/orderedList/gapcursor.
      // Disable them here so our separately-configured versions (custom Link
      // target/_blank, OrderedList numbered-list class, etc.) are the single
      // registration and win deterministically instead of double-registering.
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
      // Document,
      // DBlock,
      OrderedList.configure({
        itemTypeName: "listItem",
        HTMLAttributes: {
          class: "numbered-list",
        },
      }),
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({
        // Use a placeholder:

        placeholder:
          placeholder ??
          (allowedCommentModes.includes(mode)
            ? getRandomElement(
                globalConstants.CommentTips(isApple, createNewComment)
              )
            : isMobileView
              ? "Add a description…"
              : getRandomElement(globalConstants.DescriptionTips(isApple))),
        emptyEditorClass: `${styles.is_editor_empty}`,
        emptyNodeClass: "New Comment",
      }),
      Underline,
      // Image.configure({
      //     inline: true,
      //     allowBase64: true,
      //     HTMLAttributes: ({
      //         style: {
      //             default: 'width: 10%; height: auto; cursor: pointer;',
      //         },
      //     }),

      // }),
      SlashCommands(mode),
      Snippets,
      Link.configure({
        openOnClick: true,
        autolink: false,
        linkOnPaste: true,
        HTMLAttributes: {
          // Change rel to different value
          // Allow search engines to follow links(remove nofollow)
          // rel: 'noopener noreferrer',
          // Remove target entirely so links open in current tab
          target: "_blank",
        },
        // validate: href => /^https?:\/\//.test(href),
      }),
      ReplyBlockquote,
      Emoji.configure({
        emojis: emojis,
        enableEmoticons: true,
        suggestion: suggestion,
      }),
      ...withMentionBackspaceDeletion(
        LinkableMention.configure({
          HTMLAttributes: {
            class: "mention",
          },
          suggestion: MentionData,
        })
      ),
      ResizableMedia.configure({
        uploadFn: async (file) => {
          // You could implement your own progress tracking here
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
          // Notify the application that an upload has started
          // You could set a global loading state here
          console.log("Upload started");
          document.body.classList.add("editor-uploading");
        },
        onUploadEnd: () => {
          // Notify the application that an upload has ended
          console.log("Upload ended");
          document.body.classList.remove("editor-uploading");
        },
      }),
      DisableEnter,
      HypertaskPasteRule,
    ],
    // Build the extensions exactly once for this editor instance. They must be
    // referentially stable: Tiptap v3's useEditor reconfigures the whole plugin
    // set (destroying open suggestion popups) whenever any extension instance
    // changes between renders. mode/isApple/createNewComment are fixed per
    // instance, so capturing them on first render is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // editorProps: {
    //     handlePaste(view, event) {
    //         console.log("🚀 ~ file: TipTap.tsx:187 ~ handlePaste ~ event:", event)
    //         // console.log("🚀 ~ file: TipTap.tsx:181 ~ handlePaste ~ event:", event.clipboardData)
    //         let hasFiles = false;
    //         let reader = new FileReader();

    //         reader.onload = function (event) {
    //             let imageUrl = event?.target?.result;
    //             console.log("🚀 ~ handlePaste ~ view.state.schema?.nodes?.image:", view.state.schema?.nodes)
    //             const node = view.state.schema?.nodes?.image.create({ src: imageUrl });
    //             const transaction = view.state.tr.replaceSelectionWith(node);
    //             view.dispatch(transaction);
    //         };

    //         if (event?.clipboardData?.files) {
    //             console.log("🚀 ~ file: TipTap.tsx:194 ~ handlePaste ~ event?.clipboardData?.files:", event?.clipboardData?.files)

    //             Array.from(event?.clipboardData?.files)
    //                 .filter(item => item.type.startsWith("image"))
    //                 .forEach(item => {
    //                     reader.readAsDataURL(item);
    //                     hasFiles = true;
    //                 });

    //         }

    //         const cursorPos = editor?.state.selection.$anchor.pos;
    //         if(cursorPos) {
    //             const cursorCoords = view.coordsAtPos(cursorPos);
    //             const isCursorOutOfView =
    //               cursorCoords.top < 0 ||
    //               cursorCoords.bottom > window.innerHeight;

    //             if (isCursorOutOfView) {
    //             setTimeout(()=>{
    //                 view.dom.scrollIntoView({
    //                     behavior: 'smooth',
    //                     block: 'end',
    //                   });
    //             },10)

    //             }
    //         }

    //         if (hasFiles) {
    //             event.preventDefault();
    //             return true;
    //         }
    //     },
    // },
  });
  // Drafts arrive asynchronously (react-query), so the composer normally mounts
  // before its draft is fetched and `initialContent` freezes the mount value.
  // Drafts written outside this browser (CLI/MCP `draft create`) always lose that
  // race. Seed the editor when the stored draft differs from what it is showing,
  // for as long as the user has not touched it — see `shouldSyncDraft`. Typing,
  // posting and discarding all go through the editor and emit an update, so a late
  // or stale response can never overwrite the user or resurrect posted content.
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
    // Compare against the editor's OWN html, not the frozen mount value: a draft
    // rewritten elsewhere has to replace an older one, not just fill an empty
    // editor. Tiptap re-serialises what it is given, so this is also the only
    // comparison that stays stable across a sync.
    const incoming = normalizeEditorHtml(defaultContent);
    const rendered = normalizeEditorHtml(editor.getHTML());
    if (!shouldSyncDraft(incoming, rendered, userHasEditedRef.current)) return;
    // Replacing the document maps every position to the end, so a caret the user
    // placed but has not typed at yet would silently jump. Put it back.
    const caret = editor.isFocused ? editor.state.selection.from : null;
    // emitUpdate:false — syncing must not fire the draft autosave back at the API,
    // and must not count as the user's own edit.
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
