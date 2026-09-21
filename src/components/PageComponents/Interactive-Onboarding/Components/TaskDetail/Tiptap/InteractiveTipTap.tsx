import TiptapBubbleMenu from "@/components/RTE/Components/TiptapBubbleMenu";
import { AITaskWriterWithProvider as AITaskWriterContainer } from "@/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer";
import TipTapMainContainer from "./InteractiveTiptapContainer";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import type { Editor } from "@tiptap/react";
import { useEffect } from "react";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

interface IProps {
  type: "comment" | "description";
  editor: Editor | null;
}

export const InteractiveTiptap = ({ type, editor }: IProps) => {
  const { activeScene, AITaskWriterHandler } = useTutorialContext();

  const calculatePopoverPosition = (
    targetDiv: HTMLElement,
    popover: HTMLElement
  ) => {
    // Get the current height of the popover
    const popoverHeight = popover.offsetHeight;
    console.log("Size ===> new min height", popoverHeight + 30);
    // Set the min-height of the target div to be popover height + 30px
    targetDiv.style.minHeight = `${popoverHeight + 30}px`;
  };

  useEffect(() => {
    const popover = document.getElementById(
      "tiptap-interactive-aitaskwriter"
    ) as HTMLElement | null;
    const targetDiv = document.getElementById(
      "main-tiptap-interactive"
    ) as HTMLElement | null;
    const resizeObserver = new ResizeObserver(() => {
      console.log("Size ==> is changing");
      if (!popover) return;

      if (targetDiv) {
        calculatePopoverPosition(targetDiv, popover);
      }
    });

    if (popover) resizeObserver.observe(popover);
    else {
      targetDiv!.style.minHeight = "unset";
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeScene.index]);

  useEffect(() => {
    document
      .getElementById("comment-input-interactive")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // CTRL+M (or CMD+M) focuses the TipTap when user has focused out - same as main task detail
  useEffect(() => {
    if (!editor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const cmdControl = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (cmdControl && e.keyCode === KeyCodes.M && type === "comment") {
        e.preventDefault();
        editor.commands.focus("end");
      }
      // if (cmdControl && e.keyCode === KeyCodes.D && type === "description") {
      //   e.preventDefault();
      //   editor.commands.focus("end");
      // }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor, type]);

  return (
    <div
      id={"main-tiptap-interactive"}
      className="col-start-1 col-end-3 relative text-white-black"
    >
      {/* ============================ BUBBLE MENU ============================ */}
      <TiptapBubbleMenu
        currentProjectId={undefined}
        toggleHighlightHandler={() => {}}
        allowPerks={false}
        editor={editor}
        toggleHighlight={false}
      />

      <div
        id={"interactive-tiptap-container"}
        className={`w-full absolute z-[1000] ${
          activeScene.index === 31 && type === "description"
            ? "block h-full"
            : "hidden h-0"
        }`}
      >
        {activeScene.index === 31 && type === "description" && (
          <AITaskWriterContainer
            id={"tiptap-interactive-aitaskwriter"}
            backgroundContent={""}
            EscapeHandler={() => {}}
            AISaveHandler={(s) => {
              AITaskWriterHandler(s, true);
            }}
            returnTitleAndDescription={(title, description) => {
              AITaskWriterHandler(description, false, title);
            }}
            defaultMode={"AiTaskWriter"}
            additionalContext={
              type === "description"
                ? "You have to write your response in a manner thats well suited to be in a task description"
                : "You have to write your response in a manner thats well suited to add as a comment or when replying to a thread"
            }
          />
        )}
      </div>
      <TipTapMainContainer
        activeScene={activeScene}
        editor={editor}
        type={type}
      />
    </div>
  );
};
