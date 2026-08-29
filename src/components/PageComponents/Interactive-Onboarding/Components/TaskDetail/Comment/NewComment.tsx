import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { InteractiveTiptap } from "../Tiptap/InteractiveTipTap";
import TutorialTooltip from "../../TutorialTip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";

const NewComment = () => {
  const { activeScene, commentEditor } = useTutorialContext();
  const isApple = useDeviceContext();
  return (
    <div
      tabIndex={0}
      id="comment-input-interactive"
      className={`flex flex-col justify-between items-center my-[8px] outline-none w-full bg-comment-description shadow-md rounded-md
        border-l-4 relative group
    ${
      activeScene.index < 30
        ? ` ${
            activeScene.index === 6
              ? `border-[#C2CFA5]`
              : `border-selected-item-border`
          } bg-comment-description`
        : `border-transparent`
    }`}
    >
      <div className="pt-[20px] pb-1 px-[16px] w-full">
        <InteractiveTiptap type="comment" editor={commentEditor} />
      </div>
      {activeScene.index === 6 && (
        <TutorialTooltip
          text="Reply with 'Thank you.'"
          top={25}
          left={-160}
        />
      )}
    </div>
  );
};

export default NewComment;
