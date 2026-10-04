import SaveViewModal from "@/components/Modals/ViewModals/SaveViewModal"
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews"
import { IProject } from "@/models/model"
import { RotateCcw, Save } from "lucide-react";


import React from "react"
import Tooltip from "@/components/Common/Tooltip";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import HeaderDivider from "./HeaderDivider";


import { useFlag } from "@/hooks/useFlag";
import { HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG } from "@/lib/flags/keys";

type ControlledProps = {
  dirty: boolean;
  busy: boolean;
  onReset: () => void;
  onSaveClick: () => void;
  variant: "shell";
};
type BoardProps = { project: IProject; variant?: "legacy" | "shell" };

export const SaveView = (props: BoardProps | ControlledProps) => {
  const kanbanReuseEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG);
  if ("dirty" in props) {
    return kanbanReuseEnabled ? <ShellSaveView {...props} /> : null;
  }
  return <BoardSaveView {...props} />;
};

const ShellSaveView = ({ dirty: isDirty, busy, onReset, onSaveClick }: ControlledProps) => {
  const styleGuideEnabled = useFlag(HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG);
  const saveButton = (
  <button
    type="button"
    tabIndex={isDirty ? 0 : -1}
    disabled={busy}
    onClick={onSaveClick}
    className={styleGuideEnabled
      ? "h-8 rounded-[4px] bg-shadcn-primary px-2 text-primary-foreground transition-colors hover:opacity-90"
      : "h-8 rounded-full bg-hover-active px-2 text-[#E28C28] transition-colors hover:text-white-black"}
  >
    Save view
  </button>
  );
  const resetButton = (
  <button
    type="button"
    tabIndex={isDirty ? 0 : -1}
    disabled={busy}
    onClick={onReset}
    className={styleGuideEnabled
      ? "h-8 rounded-[4px] px-2 text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black"
      : "h-8 rounded-full bg-hover-active px-2 text-text-light-gray transition-colors hover:text-white-black"}
  >
    Reset
  </button>
  );
  return (
  <div
    aria-hidden={!isDirty}
    className={`flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap text-content font-medium transition-all duration-150 ${
      isDirty
        ? "max-w-[144px] translate-x-0 opacity-100"
        : "pointer-events-none max-w-0 translate-x-2 opacity-0"
    }`}
  >
    {styleGuideEnabled ? (
      <>
        {resetButton}
        {saveButton}
      </>
    ) : (
      <>
        {saveButton}
        {resetButton}
      </>
    )}
  </div>
  );
};

const BoardSaveView = ({
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
        <ShellSaveView dirty={isDirty} busy={false} variant="shell" onSaveClick={toggleSaveViewsModal} onReset={() => resetView("ResetCurrent")} />
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
