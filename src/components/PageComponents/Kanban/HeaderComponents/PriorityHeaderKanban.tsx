import Tooltip from "@/components/Common/Tooltip";
import BoardPriorityMode from "@/components/Modals/Kanban/BoardPriorityMode";
import { ArrowUpDown } from "lucide-react";
import { IProject } from "@/models/model";
import { getActiveSortingModeFromProject, getActiveSortingStackFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import HeaderIconWrapper from "./HeaderIconWrapper";

const PriorityHeaderKanban = ({_currentProject}:{_currentProject:IProject})=>{
    const {showKanbanSortModal, toggleBoardSortingHandler} = useSortModal()
    const sortingView = getActiveSortingModeFromProject(_currentProject)
    const stackCount = getActiveSortingStackFromProject(_currentProject).length
    return (
      <>
      <HeaderIconWrapper
        className={sortingView !== "Manual" ? "board-header-icon-active" : undefined}
        onClick={()=>toggleBoardSortingHandler()}
      >
        <ArrowUpDown
          size={16}
          strokeWidth={1.75}
          fill="none"
          className={sortingView !== "Manual" ? "text-[#51A4F1]" : "group-hover:text-header-hover-text"}
        />
        {stackCount > 0 && (
          <span className="text-micro text-[#51A4F1]">{stackCount + 1}</span>
        )}
        <Tooltip 
          left={-10}
          bottom={-40}
          text='Show sorting levels'
          keyCombination={["SHIFT","S"]}
          />
      </HeaderIconWrapper>
        {showKanbanSortModal&& <BoardPriorityMode closeHandler={toggleBoardSortingHandler}/>}
  
      </>
    )
  }
  const useSortModal = ()=>{
    const [showKanbanSortModal, setShowKanbanSortModal] = useState<boolean>(false);
  
  
    const toggleBoardSortingHandler = async(refresh?:boolean)=>{
      if (refresh) {
      }
      setShowKanbanSortModal((prev)=>!prev)
    }
  
    return {showKanbanSortModal, toggleBoardSortingHandler}
  }
  

export default PriorityHeaderKanban
