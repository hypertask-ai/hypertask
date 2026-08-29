import styles from "@/styles/tiptap.module.scss";
import AttachmentsUpload from "@/components/Common/AttachmentsUpload";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { ITutorialAtom } from "@/models/InteractiveOnboarding/model";
import { useState } from "react";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";

interface IProps {
  activeScene: ITutorialAtom;
  editor: Editor | null;
  type: "comment" | "description";
}

const TipTapMainContainer = ({ activeScene, editor, type }: IProps) => {
  const [stack, _] = useState<boolean>(true);
  return (
    <div
      style={{
        borderLeftWidth: true ? 0 : 0 }}
      onClick={(e) => {
        e.preventDefault();
      }}
      className={`
        w-full
        flex flex-col
        scrollbar-none items-center
        ${stack ? "py-1 gap-3 grid-cols-1" : ""} 
        ${
          stack &&
          (([30, 31, 32].includes(activeScene.index) &&
            type === "description") ||
            (activeScene.index === 6 && type === "comment"))
            ? "bg-transparent"
            : "bg-comment-description"
        }
        ${type === "comment" ? "comment-edit-container" : "description-edit-container"}
        ${styles.hellow}  outline-none
        ${type === "comment" ? "" : "items-center bg-transparent px-0 "}  
      `}
      tabIndex={0}
    >
      <TipTapEditor editor={editor} activeScene={activeScene} type={type} />
      {/* ================== attachment button ============= */}
      <AttachmentsUpload
        filesFromParent={[]}
        trigger={false}
        callback={() => {}}
        mode={
          type === "description"
            ? "read-edit-description"
            : "read-edit-comments"
        }
        editor={editor}
        droppedFiles={[]}
        isRecording={false}
      />
    </div>
  );
};

const TipTapEditor = ({
  editor,
  activeScene,
  type,
}: {
  editor: Editor | null;
  activeScene: ITutorialAtom;
  type: "comment" | "description";
}) => {
  //the true/false (in our stars) in the parent div's classname is stack.
  const { handleCommentInput } = useTutorialContext();
  const isClickDisabled = activeScene.index === 5;
  return (
    <div
      className={`transition-opacity w-full duration-100 @apply col-[1_/_3] scrollbar-none sm:max-h-full xs:max-w-[85vw] sm:max-w-[560px] md:max-w-full break-normal
        ${styles.editorContainer}
        mt-2
         ${true ? styles.stacked : styles.unstacked}
        ${isClickDisabled ? "pointer-events-none" : ""}
        `}
      id="interactive-tiptap-editor"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      tabIndex={true ? 0 : -1}
    >
      {editor ? (
        <EditorContent
          autoFocus={false}
          onClick={(e) => {
            e.preventDefault();
          }}
          onChange={
            activeScene.index === 6 && type === "comment"
              ? handleCommentInput(editor.getText())
              : () => {}
          }
          className=""
          editor={editor}
        />
      ) : (
        <div className="h-[21px]"></div>
      )}
    </div>
  );
};

export default TipTapMainContainer;
