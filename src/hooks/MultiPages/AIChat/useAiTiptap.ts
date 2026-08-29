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
import Mention from "@tiptap/extension-mention";
import { createMentionData } from "@/components/RTE/Components/AI_Chat/MentionData";
import SlashCommands from "@/components/RTE/Extensions/SlashCommands/SlashCommands";
import { useContext, useRef } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

const DisableEnter = Extension.create({
  addKeyboardShortcuts() {
    return {
      "Control-Enter": () => true,
      "Mod-Enter": () => true,
    };
  },
});

const CustomMention = Mention.extend({
  addAttributes() {
    // Check if parent is a function before invoking it
    const parentAttributes =
      typeof this.parent === "function" ? this.parent() : {};

    return {
      ...parentAttributes, // Spread the result of parent() or an empty object if parent is undefined
      uniqueIndex: {
        default: "",
      },
      projectId: {
        default: "",
      },
      text: {
        default: "",
      },
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
  // There is no Ctrl key on a phone, so the desktop hint is noise there.
  // Read through a ref: the editor config is built once on mount, and the
  // placeholder is a function so it picks up the current value instead.
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
        // Use a placeholder:

        placeholder: () =>
          isMobileRef.current
            ? `@ for context`
            : `Focus with CTRL + Q, @ for context`,
        emptyEditorClass: `${styles.is_editor_empty}`,
        emptyNodeClass: "New Comment",
      }),
      Underline.extend({ inclusive: false }),
      //   Link.configure({
      //     openOnClick: true,
      //     autolink: false,
      //     linkOnPaste: true,
      //     HTMLAttributes: {
      //       // Change rel to different value
      //       // Allow search engines to follow links(remove nofollow)
      //       // rel: 'noopener noreferrer',
      //       // Remove target entirely so links open in current tab
      //       target: "_blank",
      //     },
      //     // validate: href => /^https?:\/\//.test(href),
      //   }),
      CustomMention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: createMentionData(
          contextCallback,
          () => projectIdRef.current
        ),
        renderLabel({ options, node }) {
          return `${node.attrs.text ?? node.attrs.text}`;
        },
      }),
      // "/" opens a skills picker (board + personal). Selecting one inserts
      // "/slug ", which the chat stream route resolves server-side.
      SlashCommands("ai-chat"),
      DisableEnter,
    ],
    // content: defaultContent,
    immediatelyRender: false,
  });
  return {
    editor,
  };
};

export default useTiptapForAI;
