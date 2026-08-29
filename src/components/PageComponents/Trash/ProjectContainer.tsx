/* eslint-disable react/jsx-key */

import { ITask ,IProject} from '@/models/model';
import React from 'react'

import { useTrashContext } from '@/lib/contexts/Trash/TrashProvider';
import TaskRow from './TaskRow';
import ConfirmTaskDelete from '@/components/Modals/confirmDeleteModals/confirmtTaskDelete';
interface ITasksContainer {
    project:IProject;
    tasks:ITask[];

   }
const ProjectContainer: React.FC<ITasksContainer> = ({ project,tasks }) => {    

    const {selectedIndex,  handleMouseMove, showConfirmation, deleteHandler, toggleConfirmation}= useTrashContext()

     // CONFIRM DELETE
     const confirmDelete = async(response:boolean)=>{

      if(response)   deleteHandler("delete")
      toggleConfirmation()
  }

   
    return (
      <>
      
       <div
        onMouseMove={handleMouseMove} 
        style={{ flex: 1, display: `flex`, width: '100%', flexDirection: 'column',overflowY:"auto" }}
        className='flex justify-start flex-col-reverse relative sm:mt-4'
          >
         {tasks?.map((task, index) => (
            <TaskRow task={task} index={index} selected = {tasks[selectedIndex]?.id===task.id}/>
         
         ))}
       </div>
         { showConfirmation && <ConfirmTaskDelete content='Clicking confirm will permanently delete this task. This action cannot be reverted.' confirmDelete={confirmDelete}/>}
       </>
    );
   };

export default ProjectContainer


