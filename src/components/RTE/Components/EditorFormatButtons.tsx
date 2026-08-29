// EditorButtons.tsx
import type { Editor } from "@tiptap/react";
import React from "react";
import { Code, CodeXml, Link, List, ListOrdered, Unlink } from "lucide-react";
import { useSetRecoilState } from "@/lib/state";
import { showSetLinkModalAtom } from "@/store";

// Function to unset a link
const unsetLink = (editor: Editor) => {
  editor.chain().focus().unsetLink().run();
};

// ... Define other button actions here

// I know this code is ancient when an image is being used to display an icon. {._.}
// Component for the Set Link button
const SetLinkButton = ({ editor }: { editor: Editor }) => {
  const setShowSetLinkModal = useSetRecoilState(showSetLinkModalAtom);
  const isActive = editor.isActive("link");
  return (
    <button
      onClick={() => setShowSetLinkModal(true)}
      className={isActive ? "is-active" : ""}
    >
      <Link size={18} strokeWidth={1.75} />
    </button>
  );
};

const toggleBold = (editor: Editor) => {
  editor.chain().focus().toggleBold().run();
};

const toggleItalic = (editor: Editor) => {
  editor.chain().focus().toggleItalic().run();
};

const toggleUnderline = (editor: Editor) => {
  editor.chain().focus().toggleUnderline().run();
};

const toggleHeading = (editor: Editor, level: any) => {
  editor.chain().focus().toggleHeading({ level: level }).run();
};

const setParagraph = (editor: Editor) => {
  editor.chain().focus().setParagraph().run();
};

const setCode = (editor: Editor, block: boolean = false) => {
  const selectAllIfNeeded = () => {
    const { from, to } = editor.state.selection ?? { from: 0, to: 0 };
    if (from === to) editor.chain().focus().selectAll().run();
    return editor.state.selection ?? { from: 0, to: 0 };
  };

  if (block) {
    const { from, to } = selectAllIfNeeded();
    const text = editor.state.doc.textBetween(from, to, "\n");
    editor.chain().focus().deleteSelection().insertContent({
      type: "codeBlock",
      content: text ? [{ type: "text", text }] : undefined,
      attrs: { language: "javascript" },
    }).run();
  } else {
    const { from, to } = editor.state.selection ?? { from: 0, to: 0 };
    editor.chain()
      .focus()
      .command(({ commands }) => (from === to ? commands.selectAll() : true))
      .setCode()
      .run();
  }
};

// Component for the Unset Link button
const UnsetLinkButton = ({ editor }: { editor: Editor }) => {
  return (
    <button
      onClick={() => unsetLink(editor)}
      disabled={!editor.isActive("link")}
    >
      <Unlink size={18} strokeWidth={1.75} />
    </button>
  );
};

// Component for the Toggle Highlight button
const ToggleHighlightButton = ({
  editor,
  setToggleHighlightbutton,
}: {
  editor: Editor;
  setToggleHighlightbutton?: (state: boolean) => void;
}) => {
  return (
    <button
      onClick={() => setToggleHighlightbutton && setToggleHighlightbutton(true)}
    >
      Highlight
    </button>
  );
};

// Button components
const BoldButton = ({ editor }: { editor: Editor }) => {
  const isActive = editor.isActive("bold");
  return (
    <button
      onClick={() => toggleBold(editor)}
      className={`${isActive ? "is-active" : ""} text-emphasis`}
    >
      B
    </button>
  );
};

const ItalicButton = ({ editor }: { editor: Editor }) => {
  const isActive = editor.isActive("italic");
  return (
    <button
      onClick={() => toggleItalic(editor)}
      className={`${isActive ? "is-active" : ""} italic`}
    >
      I
    </button>
  );
};

const UnderlineButton = ({ editor }: { editor: Editor }) => {
  const isActive = editor.isActive("underline");
  return (
    <button
      onClick={() => toggleUnderline(editor)}
      className={`${isActive ? "is-active" : ""} underline`}
    >
      U
    </button>
  );
};

const HeadingButton = ({ editor, level }: { editor: Editor; level?: any }) => {
  const isActive = editor.isActive("heading", { level });
  return (
    <button
      onClick={() => toggleHeading(editor, level)}
      className={`${isActive ? "is-active" : ""} hover:bg-slate-400`}
    >
      {level === 1 ? "h1" : "h2"}
    </button>
  );
};

const ParagraphButton = ({ editor }: { editor: Editor }) => {
  const isActive = editor.isActive("paragraph");
  return (
    <button
      onClick={() => setParagraph(editor)}
      className={`${isActive ? "is-active" : ""}`}
    >
      Normal
    </button>
  );
};

const SetOrderedListButton = ({ editor }: { editor: Editor }) => {
  return (
    <button onClick={() => editor.chain().focus().toggleOrderedList().run()}>
      <ListOrdered size={18} strokeWidth={1.75} />
    </button>
  );
};

const SetBulletListButton = ({
  editor,
  level,
}: {
  editor: Editor;
  level?: any;
}) => {
  const isActive = editor.isActive("heading", { level });
  return (
    <button onClick={() => editor.chain().focus().toggleBulletList().run()}>
      <List size={18} strokeWidth={1.75} />
    </button>
  );
};

const SetCodeButton = ({ editor }: { editor: Editor }) => {
  return (
    <button onClick={() => setCode(editor)}>
      <Code size={18} strokeWidth={1.75} />
    </button>
  );
};

const SetCodeBlockButton = ({ editor }: { editor: Editor }) => {
  return (
    <button onClick={() => setCode(editor, true)}>
      <CodeXml size={18} strokeWidth={1.75} />
    </button>
  );
};

const buttonConfigs = [
  {
    component: SetLinkButton,
    props: {}, // Any additional props for SetLinkButton
  },
  {
    component: SetOrderedListButton,
    props: {}, // Any additional props for SetLinkButton
  },
  {
    component: SetBulletListButton,
    props: {}, // Any additional props for SetLinkButton
  },
  {
    component: UnsetLinkButton,
    props: {}, // Any additional props for UnsetLinkButton
  },
  {
    component: ToggleHighlightButton,
    props: {}, // Any additional props for ToggleHighlightButton,
    id: "HighlightButton",
  },

  {
    component: BoldButton,
    props: {}, // Any additional props for BoldButton
  },
  {
    component: ItalicButton,
    props: {}, // Any additional props for ItalicButton
  },
  {
    component: UnderlineButton,
    props: {}, // Any additional props for UnderlineButton
  },
  {
    component: HeadingButton,
    props: { level: 1 }, // Props for HeadingButton with level 1
  },
  {
    component: HeadingButton,
    props: { level: 2 }, // Props for HeadingButton with level 2
  },
  {
    component: ParagraphButton,
    props: {}, // Any additional props for ParagraphButton
  },
  {
    component: SetCodeButton,
    props: {},
  },
  {
    component: SetCodeBlockButton,
    props: {},
  },
  // ... Add other button configurations here
];

// ... (other button components and exports)

// Export the button configurations
export { buttonConfigs };
