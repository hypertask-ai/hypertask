import SaveViewModal from "@/components/Modals/ViewModals/SaveViewModal"
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews"
import { IProject } from "@/models/model"
import { RotateCcw, Save } from "lucide-react";


import React, { useState } from "react"
import Tooltip from "@/components/Common/Tooltip";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import HeaderDivider from "./HeaderDivider";


export const SaveView = ({
  project,
  variant = "legacy",
}: {
  project: IProject;
  variant?: "legacy" | "shell";
}) => {

  const { resetView } = useKanbanViews(project)
  
  const {toggleSaveViewsModal, showSaveModal} = useKanbanModalStatesContext()
  const isDirty = Boolean(
    project.project_view?.user_project_views[0]?.unsavedView
  )

  if (variant === "shell") {
    return (
      <>
        <div
          aria-hidden={!isDirty}
          className={`flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap text-content font-medium transition-all duration-150 ${
            isDirty
              ? "max-w-[144px] translate-x-0 opacity-100"
              : "pointer-events-none max-w-0 translate-x-2 opacity-0"
          }`}
        >
          <button
            type="button"
            tabIndex={isDirty ? 0 : -1}
            onClick={toggleSaveViewsModal}
            className="h-8 rounded-full bg-hover-active px-2 text-[#E28C28] transition-colors hover:text-white-black"
          >
            Save view
          </button>
          <button
            type="button"
            tabIndex={isDirty ? 0 : -1}
            onClick={() => resetView("ResetCurrent")}
            className="h-8 rounded-full bg-hover-active px-2 text-text-light-gray transition-colors hover:text-white-black"
          >
            Reset
          </button>
        </div>
        {showSaveModal && (
          <SaveViewModal toggle={toggleSaveViewsModal} project={project} />
        )}
      </>
    )
  }

  
  return (
    <>
    {
      isDirty &&
      <>
      <HeaderDivider />
      {/* could refactor it, the change came later */}
      <div  className=' gap-3 flex lg:hidden  text-content items-center font-medium'>
        <span onClick={toggleSaveViewsModal} className="group relative" >
          <Save size={18} className="text-white-black hover:text-header-hover-text cursor-pointer"  strokeWidth={1.75}/>
          <Tooltip  
              left={-10}
              bottom={-40}
              text='Save view'
              keyCombination={[]}
              />
        </span>
        <span onClick={()=>resetView("ResetCurrent")} className="group relative" >
          <RotateCcw size={18} className="text-white-black font-bold hover:text-header-hover-text cursor-pointer bold-pop-exempt"  strokeWidth={1.75}/>
          <Tooltip  
              left={-10}
              bottom={-40}
              text='Reset view'
              keyCombination={[]}
              />
        </span>
      </div>

      <div  className=' gap-3 hidden lg:flex  text-content  font-medium'>
        <span onClick={toggleSaveViewsModal} className="text-[#E28C28] cursor-pointer relative group">
          Save View
          <Tooltip
            left={-10}
            bottom={-40}
            text='Save View'
            keyCombination={['SHIFT','V']}
          />
        </span>
        <span onClick={()=>resetView("ResetCurrent")} className="cursor-pointer text-white-black hover:text-white-black">
          Reset
        </span>
        
      </div>
      </>
    }
      {
        showSaveModal && <SaveViewModal toggle={toggleSaveViewsModal} project={project} />
      }
    </>
  )
}
