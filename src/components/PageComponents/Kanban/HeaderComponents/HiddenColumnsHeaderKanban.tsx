import Tooltip from "@/components/Common/Tooltip"
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext"
import { HiddenColumnLogo } from "@/lib/IconsLocal"
import { IProject } from "@/models/model"
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions"
import React, { useMemo } from "react"
import { Eye } from "lucide-react";

import HeaderIconWrapper from "./HeaderIconWrapper"
import { useSetRecoilState } from "@/lib/state"
import { showCommandsAtom } from "@/store"
import { CommandMode } from "@/models/enums"


const HiddenColumns = (
    {
      currentProject,
  
    }:{
      currentProject:IProject,
      
    }
  )=>{
    const setShowCommands = useSetRecoilState(showCommandsAtom);
    
    const currentColumns = getActiveColumnsViewFromProject(currentProject)
    const shouldShowBlue = useMemo(()=>currentColumns?.some(x=>!x.visibility),[currentColumns])
    return(
      
        currentProject._count ?
        <HeaderIconWrapper
          className={shouldShowBlue ? "board-header-icon-active" : undefined}
          onClick={()=>setShowCommands({ show: true, mode: CommandMode.ManageColumn })}
        >
            <Eye
              size={16}
              strokeWidth={1.75}
              fill="none"
              className={shouldShowBlue ? "text-[#51A4F1]" : "group-hover:text-header-hover-text"}
            />
            {/* <p className='text-content text-header-text group-hover:text-header-hover-text'>{currentProject._count.section}</p> */}
            <Tooltip  
              left={-10}
              bottom={-40}
              text='See hidden columns'
              keyCombination={[]}
              />
        </HeaderIconWrapper>
        :
        <></>
      
    )
  }

export default HiddenColumns
