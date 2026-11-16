"use client"

import Tooltip from "@/components/Common/Tooltip";
import { isAiChatSidebarModeAtom, showAIChatInterfaceAtom, tasksPlayListAtom } from "@/store";
import { useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useRecoilState } from "@/lib/state";
import { getTaskPlaylistBounds } from "@/lib/taskDetailSwipe";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9387_HEADER_ARROWS_FLAG } from "@/lib/flags/definitions/htpr-9387-header-arrows";

const TaskMovement =(
    {
        navigateToNextTask,
        navigateToPreviousTask,
        currentItemInTasksPlaylist,
        placement = "rail",
    }:{
        navigateToNextTask:(archiveNotification?: boolean, navigate?: boolean) => void,
        navigateToPreviousTask:(isUndoClicked:boolean, checkIfUndo: boolean) => void;
        currentItemInTasksPlaylist: {
            projectId: number;
            uniqueIndex: any;
        }
        placement?: "header" | "rail";
    }
)=>{
    const [tasksPlayList] = useRecoilState(tasksPlayListAtom);
    const [showAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
    const [isSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
    const headerArrows = useFlag(HTPR_9387_HEADER_ARROWS_FLAG);
    
    const { currentIndex: indexOf, previousDisabled, nextDisabled } = useMemo(
        () => getTaskPlaylistBounds(tasksPlayList, currentItemInTasksPlaylist),
        [currentItemInTasksPlaylist, tasksPlayList]
    );

    const iconSize = headerArrows && placement === "header" ? 16 : 18;
    const previous = (
        <span
            onClick={()=>navigateToPreviousTask(false, false)}
            aria-disabled={previousDisabled}
            data-task-nav-direction="previous"
            className="w-10 h-[28px] grid place-items-center relative group border-white cursor-pointer"
            >
            <ChevronUp size={iconSize}
                className={`mx-auto text-text-light-gray transition-colors group-hover:text-white-black ${previousDisabled ? "opacity-40" : ""}`}
                 strokeWidth={1.75}/>
            <Tooltip 
                left={0}
                bottom={-53}
                text='Navigate to previous task'
                keyCombination={["K"]}
                />
        </span>
    );
    const next = (
        <span                
            onClick={()=>navigateToNextTask(false, true)}
            aria-disabled={nextDisabled}
            data-task-nav-direction="next"
            className="w-10 h-[28px] grid place-items-center relative group cursor-pointer"
            >
            <ChevronDown size={iconSize}
                className={`text-text-light-gray transition-colors group-hover:text-white-black ${nextDisabled ? "opacity-40" : ""}`}
                 strokeWidth={1.75}/>
            <Tooltip 
                left={0}
                bottom={-53}
                text='Navigate to next task'
                keyCombination={["J"]}
                />
        </span>
    );
    const count = tasksPlayList&&indexOf!==undefined && indexOf>-1&& tasksPlayList.length>0 ? (
        <span className="text-meta text-white-black">
            {indexOf+1} / {tasksPlayList?.length??0}
        </span>
    ) : null;

    if (headerArrows && placement === "header") {
        return (
            <div data-task-nav="header" className="flex items-center self-start mt-[9.75px] gap-0.5">
                {previous}
                {next}
                {count}
            </div>
        );
    }

    return (
        <>
            <div
                data-task-nav="rail"
                className={`task-nav-controls flex rounded-[20px] py-[6px] mx-1 items-center justify-center bg-back-button shadow-md flex-col ${showAiChatInterface && isSidebarMode ? "" : "xl:flex-row"}`}
                >
                {previous}
                {next}
            </div>
            {count}
        </>
    )
}

export default TaskMovement
