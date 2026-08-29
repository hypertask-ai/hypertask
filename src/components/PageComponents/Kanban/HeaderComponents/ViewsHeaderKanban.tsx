import { IProject } from '@/models/model'
import React from 'react'
import { cn } from '@/utils/undoActions/helperFuncs'
import ViewsForBoard from '@/components/Modals/ViewModals/ViewsForBoardModal'
import Tooltip from '@/components/Common/Tooltip'
import { Layers } from 'lucide-react'
import { useKanbanModalStatesContext } from '@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext'
import ManageViews from '@/components/Modals/ViewModals/ManageViewsModals'

interface IProps {
  currentProject: IProject
}
const ViewsHeaderKanban: React.FC<IProps> = ({ currentProject }) => {

  const {toggleViewsModal, showViewsModal, showManageViewsModal, toggleManageViewsModal} = useKanbanModalStatesContext()

  
  return (
    <>
      <ViewsHeaderIcon 
        isActive={!!currentProject.project_view?.user_project_views[0]?.appliedView} 
        onClick={()=>toggleViewsModal()} 
        className='cursor-pointer' />
      {
        showManageViewsModal && <ManageViews toggle={toggleManageViewsModal} />
      }
      {showViewsModal && <ViewsForBoard toggle={toggleViewsModal} project={currentProject} />}
    </>
  )
}

export default ViewsHeaderKanban


const ViewsHeaderIcon = ({
  className,
  onClick,
  isActive
}: {
  className?: string;
  onClick: any;
  isActive: boolean
}) => {
  const iconColorClass = isActive
    ? "board-header-icon-active text-[#51A4F1]"
    : "text-white-black group-hover:text-header-hover-text";
    return (
    <span
      onClick={onClick}
      className={cn(className, "board-header-icon group relative", iconColorClass)}
      >
      <Layers size={16} strokeWidth={1.75} fill="none" />
      <Tooltip
        keyCombination={["G",null,"V"]}
        text='Go to views'
        left={-10}
        bottom={-40}
        />
    </span>

  )
}

// blue: #2383e2
// gray: #76777a
