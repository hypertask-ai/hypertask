import { TBoardSubtaskSetting } from "@/models/Views/model";
import React from "react";
import { Reply } from "lucide-react";

interface ISubtaskCount {
  currentSetting?: TBoardSubtaskSetting;
  countSubTask: number;
  compact?: boolean;
}

const SubtaskCount: React.FC<ISubtaskCount> = ({
  currentSetting,
  countSubTask,
  compact = false,
}) => {
  return currentSetting !== "None" &&
    countSubTask > 0 ? (
    <div
      className="bg-inherit border-[0px]  h-labelComponent 
          text-emphasis
          border-border-labelComponent rounded-sm flex gap-1 items-center px-[4px] py-[1px]"
    >
       <Reply size={compact ? 12 : 14} className={'text-label-component rotate-180'} strokeWidth={1.75}/>
      <span className={compact ? "text-label-component text-micro leading-4" : "text-label-component text-meta"}>{countSubTask}</span>
    </div>
  ) : (
    <></>
  );
};

export default SubtaskCount;
