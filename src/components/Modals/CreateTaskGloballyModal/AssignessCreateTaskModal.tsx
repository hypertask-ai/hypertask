import { TaskInfoRow } from '@/components/PageComponents/TaskDetail/MainPageComponents'
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { IUser } from '@/models/model';
import React, { useContext, useState } from 'react'

const AssignessCreateTaskModal = () => {
    const isMbl = useContext(MobileViewContext);
    const [assignedUsers, setAssignedUsers] = useState<IUser[]>([]);

    
    return (
        <TaskInfoRow>
            <></>
        </TaskInfoRow>
    )
}

export default AssignessCreateTaskModal