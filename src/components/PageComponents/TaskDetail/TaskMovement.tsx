"use client"

import Tooltip from "@/components/Common/Tooltip";
import { isAiChatSidebarModeAtom, showAIChatInterfaceAtom, tasksPlayListAtom } from "@/store";
import { useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useRecoilState } from "@/lib/state";
import { getTaskPlaylistBounds } from "@/lib/taskDetailSwipe";

const TaskMovement =(
    {
        
        navigateToNextTask,
        navigateToPreviousTask,
        currentItemInTasksPlaylist
    }:{
        navigateToNextTask:(archiveNotification?: boolean, navigate?: boolean) => void,
        navigateToPreviousTask:(isUndoClicked:boolean, checkIfUndo: boolean) => void;
        currentItemInTasksPlaylist: {
            projectId: number;
            uniqueIndex: any;
        }
    }
)=>{
    const [tasksPlayList, _] = useRecoilState(tasksPlayListAtom);
    const [showAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
    const [isSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
    
    const { currentIndex: indexOf, previousDisabled, nextDisabled } = useMemo(
        () => getTaskPlaylistBounds(tasksPlayList, currentItemInTasksPlaylist),
        [currentItemInTasksPlaylist, tasksPlayList]
    );
  
    return (
        <>

            {/* ======================= arrow container ======================== */}
            <div
                className={`task-nav-controls flex rounded-[20px] py-[6px] mx-1 items-center justify-center bg-back-button shadow-md flex-col ${showAiChatInterface && isSidebarMode ? "" : "xl:flex-row"}`}
                >

                {/* ======================= arrow up ================ */}
                <span
                    onClick={()=>navigateToPreviousTask(false, false)}
                    aria-disabled={previousDisabled}
                    className="w-10 h-[28px] grid place-items-center relative group border-white cursor-pointer"
                    >
                    <ChevronUp size={18}
                        className={`mx-auto text-text-light-gray transition-colors group-hover:text-white-black ${previousDisabled ? "opacity-40" : ""}`}
                         strokeWidth={1.75}/>
                    <Tooltip 
                        left={0}
                        bottom={-53}
                        text='Navigate to previous task'
                        keyCombination={["K"]}
                        />
                </span>

                {/* ======================= arrow down ================ */}
                <span                
                    onClick={()=>navigateToNextTask(false, true)}
                    aria-disabled={nextDisabled}
                    className={`w-10 h-[28px] grid place-items-center relative group cursor-pointer
                    
                    `}
                    >
                    <ChevronDown size={18}
                        className={`text-text-light-gray transition-colors group-hover:text-white-black ${nextDisabled ? "opacity-40" : ""}`}
                         strokeWidth={1.75}/>
                    <Tooltip 
                        left={0}
                        bottom={-53}
                        text='Navigate to next task'
                        keyCombination={["J"]}
                        />
                </span>

            </div>

            {
                tasksPlayList&&indexOf!==undefined && indexOf>-1&& tasksPlayList.length>0&& 
                    <span className="text-meta text-white-black">
                        {indexOf+1} / {tasksPlayList?.length??0}
                    </span>
            }
        </>
    )
}

export default TaskMovement
