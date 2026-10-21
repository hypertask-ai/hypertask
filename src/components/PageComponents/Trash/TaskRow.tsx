
import { ITask } from '@/models/model';
import React from 'react'
import { convertToPlain } from '@/utils/helperFunctions/helperFunctions';
import { Trash2, RotateCcw } from "lucide-react";
import { useTrashContext } from '@/lib/contexts/Trash/TrashProvider';
import TaskRowComponent from '@/components/Common/TaskRowComponents';
import Tooltip from '@/components/Common/Tooltip';

import DueDateLabel from '@/components/Labels/DueDateLabel';
import { cn } from '@/utils/undoActions/helperFuncs';
import { inboxConfig } from '@/lib/configs/inbox.config';
import PriorityLabelComponent from '@/components/Modals/TaskPriority/PriorityLabelComponent';
import EstimateLabelComponent from '@/components/Modals/TaskEstimate/EstimateLabelComponent';
import TaskLabelComponent from '@/components/Modals/CreateLabel/TaskLabelComponent';

const TaskRow = (
    {
      task, index, selected
    }:{
      task:ITask;
      index:number;
      selected:boolean
    }
  )=>{
    const { taskRef, handleMouseEnter, handleMouseLeave, deleteHandler}= useTrashContext()
    return (
      
        <TaskRowComponent.TaskRowContainer
          key={task.id}
          index={index}
          selected={selected}
          divId={index}
          handleMouseEnter={handleMouseEnter}
          handleMouseLeave={handleMouseLeave}
          divType="trash"
          taskRef={taskRef}
          openTask={() => console.log("s")}
          className={`flex cursor-pointer sm:space-x-8 h-[70] py-2 justify-start sm:border-l-4 border-transparent px-3 sm:px-4 rounded-md ${
                        selected ? "sm:bg-active-elementBg border-l-white-black" : "transparent"
                    } w-full flex-col md:flex-row`}
        >
           <TaskRowComponent.TaskCreator displayName={task.user?.displayName??""}/>
           <TitleContainer className='flex self-start' task={task}/>
           <TaskRowComponent.CreatedAtRowElement className="flex justify-end grow w-1/4" createdAt={task.permanentlyDeleteAt!} futureDate={true}/>
           <div className={` hidden min-w-[42px] ${selected?"sm:block":"sm:block"} flex items-center`}>
              <div className='flex items-center gap-2'>

                <DeleteTaskPermanentlyButton show={selected}/>
                <RecoverTaskButton show={selected}/>
              </div>
           </div>
        </TaskRowComponent.TaskRowContainer>
  
    )
  
  }
  
export default TaskRow;

interface ITaskDescription {
    task:ITask;
  
   }
   const TaskDescription:React.FC<ITaskDescription> = ({task})=>{
    return (
      typeof window !== "undefined" ?
  
          <span
            className='truncate w-1/4'
            >
            {convertToPlain(task.description ?? "")}
          </span>
    
    :<></>
    )
   }
  
const RecoverTaskButton = ({
  show
}:{
  show:boolean
})=>{
  const {  deleteHandler}= useTrashContext()



  return (
    <span className={` w-[15px] ml-auto flex justify-end grow  self-center`} >

    <button
                  className="relative group"
                  onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteHandler("recover")
                  }}
              >
                  <Tooltip
                      left={-195}
                      bottom={-48}
                      text="Recover this task"
                      keyCombination={["#"]}
                  />
              <RotateCcw size={18} className={`${show ?"visible":"hidden"}`} strokeWidth={1.75}/>
              </button>
  </span>
  )
}
   

const DeleteTaskPermanentlyButton = (
  {
    show,
  }:{
    show:boolean;

  }
)=>{
  const {toggleConfirmation}= useTrashContext()

return (
    <span className={` w-[15px] ml-auto flex justify-end grow  self-center`} >

      <button
                    className="relative group"
                    onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleConfirmation()
                    }}
                >
                    <Trash2 size={18} className={`${show ?"visible":"hidden"}`}   strokeWidth={1.75}/>
                </button>
    </span>
)
}

interface ITitleContainer {
    task: ITask
    className?: string
}

const TitleContainer: React.FC<ITitleContainer> = ({ className, task }) => {

    const defaultClassName = "truncate flex-1 flex-column sm:flex-initial"

    return (
        <div
            suppressHydrationWarning
            className={className ? className : defaultClassName}
        >
            <span
                className="flex items-center truncate justify-start gap-1 xs:flex-wrap md:flex-nowrap"
                style={{
                    fontSize: 14,
                }}
            >

                {task?.dueDate && (
                    <DueDateLabel
                        flexBasis={false}
                        fontSize={10}
                        dueDate={task.dueDate}
                        className={cn(inboxConfig.bulkSelectionStyling.taskLabels(false))}

                    />
                )}
                {task?.priority && (
                    <PriorityLabelComponent
                        flexBasis={false}
                        fontSize={10}
                        priority={task?.priority}
                        className={cn(inboxConfig.bulkSelectionStyling.taskLabels(false))}

                    />
                )}

                {task?.estimate && (
                    <EstimateLabelComponent
                        flexBasis={false}
                        fontSize={10}
                        estimate={task.estimate}
                        className={cn(inboxConfig.bulkSelectionStyling.taskLabels(false))}
                    />
                )}
                {
                    task?.taskLabels?.map((taskLabel, index) =>

                        taskLabel.label?.value &&
                        <TaskLabelComponent
                            flexBasis={false}
                            key={`task-title-label-${taskLabel.label?.value}`}
                            stopPropogation={false}
                            labelValue={taskLabel.label?.value}
                            className={cn(inboxConfig.bulkSelectionStyling.taskLabels(false))}
                        />


                    )

                }
                <div

                    className={`xs:inline sm:flex gap-1 `}>
                    <span className={cn(inboxConfig.bulkSelectionStyling.ticketNumber(false), '')}>
                        {
                            task?.ticketNumber + " "
                        }
                    </span>
                    <span
                        className={cn(inboxConfig.bulkSelectionStyling.taskTitle(false), 'xs:whitespace-pre-wrap sm:whitespace-nowrap')}>
                        {
                            task.title ?? ""
                        }
                    </span>
                </div>
            </span>
        </div>
    )
}
