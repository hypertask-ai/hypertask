import { TaskInfoRow } from '@/components/PageComponents/TaskDetail/MainPageComponents'
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { IUser } from '@/models/model';
import React, { useContext, useState } from 'react'

const AssignessCreateTaskModal = () => {
    const isMbl = useContext(MobileViewContext);
    const [assignedUsers, setAssignedUsers] = useState<IUser[]>([]);

    
    return (
        <TaskInfoRow>
            {/* <AssigneesContainer
                showAssignModal_={showAssignModal}
                toggleModal={toggleModal}
                slugs={[]}
                currentTask={_parsedTask}
            /> */}
            <></>
        </TaskInfoRow>
    )
}

export default AssignessCreateTaskModal