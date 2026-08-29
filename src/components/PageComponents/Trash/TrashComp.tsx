"use client"
import PageContainer from '@/components/Common/PageContainer';
import TaskRowContainer from '@/components/Common/TaskRowComponents/TaskRowContainer';
import { IProject, ITask } from '@/models/model'
import React, {ReactNode} from 'react'
import ProjectContainer from './ProjectContainer';
import { useGetTrashByProjectId } from '@/hooks/Trash/useGetTrashByProjectId';
import { TrashContextProvider } from '@/lib/contexts/Trash/TrashProvider';

interface ITrashComp{
    project:any
}
const TrashComp: React.FC<ITrashComp> = ({ project }) => {
    
    const {data}=useGetTrashByProjectId(project.id, project)
    return (
       <>
        <PageContainer title={`${project.title} - Trash`}>
            <TrashContextProvider project={data} tasks={data.tasks??[]}>
                <ProjectContainer project={data} tasks={data.tasks??[]}/>
            </TrashContextProvider>
            
        </PageContainer>
       </>
    );
   };
   
export default TrashComp
