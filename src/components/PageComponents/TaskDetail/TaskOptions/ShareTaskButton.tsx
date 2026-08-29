import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { CommandMode } from "@/models/enums";
import { inViewObjectAtom, showCommandsAtom } from "@/store";
import React, { useContext, useState } from "react";
import { Share2 } from "lucide-react";
import { TOUCH_HALO } from "@/lib/configs/general.config";
import { useRecoilState } from "@/lib/state";

const ShareTaskButton = () => {
  const _mbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const { currentTask } = useTaskContext();
  const [_, setShowCommands] = useRecoilState(showCommandsAtom);
  const [___, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [hover, setHover] = useState<boolean>(false);

  const toggleShareTaskModal = () => {
    currentTask &&
      setInViewObject({
        taskId: currentTask?.id!,
        taskProjectId: currentTask?.projectId,
        taskTicketNumber: currentTask?.ticketNumber,
        taskTitle: currentTask?.title,
        sectionId: currentTask?.sectionId,
        sectionTitle: currentTask?.section,
      });
    return setShowCommands({
      show: true,
      mode: CommandMode.ShareTaskPublic,
    });
  };

  return _mbl ? (
    <div
      tabIndex={0}
      id="share-task-button"
      className="h-8 w-8 flex items-center justify-center bg-back-button rounded-full group"
    >
      {/* Fill the circle: a button sized to the icon leaves the visible ring dead to the thumb. */}
      <button
        tabIndex={-1}
        aria-label="Share task"
        onClick={toggleShareTaskModal}
        className={`relative flex h-full w-full items-center justify-center ${TOUCH_HALO}`}
      >
        <Share2 size={22} strokeWidth={1.75} className="text-[#8E9093]" />
      </button>
    </div>
  ) : (
    <span
      tabIndex={-1}
      id="share-task-title-button"
      onClick={toggleShareTaskModal}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`share-task-button relative group text-[#696b6e] ${
        hover ? "bg-comment-description" : "bg-taskDetailPage-container"
      } font-bold py-[2px] px-[4px] rounded-sm cursor-pointer text-content
       ${hover && "shadow-md"}
         `}
    >
      Share
      <Tooltip
        left={-160}
        bottom={-45}
        text={"Share task"}
        keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "S"]}
      />
    </span>
  );
};

export default ShareTaskButton;
