import { ModalContainerCustom } from '@/components/Common/CommonModalComponents';
import React, { useEffect} from 'react'
import styles from '@/styles/linksModal.module.scss'
import { useRecoilState } from '@/lib/state';
import { currentProjectAtom } from '@/store';
import { CreateTaskModalProvider } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal';
import CreateTaskModalBody from './CreateTaskModalBody';
import { CreateTaskInfoColumnProvider } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn';

interface IProps {
    shouldShow: boolean;
    closeCallback: () => void
}
const CreateTaskGlobally: React.FC<IProps> = ({ shouldShow, closeCallback }) => {
    // console.log("🚀 ~ shouldShow:", shouldShow)

    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    if (!shouldShow) return (<></>)
    return (
        <ModalContainerCustom
            // fade={false}
            id="createTaskModal"
            fullScreen={true}
            isOpen={shouldShow}
            keyboard={false}
            onOpened={() => { }}
            key={`create-task-modal-container-for-project:${_currentProject?.id}`}
            toggle={closeCallback}
            className={`${styles.links_modal} relative`}
        >
            <CreateTaskInfoColumnProvider>
                <CreateTaskModalProvider>
                    
                    <CreateTaskModalBody/>
                </CreateTaskModalProvider>
            </CreateTaskInfoColumnProvider>
        </ModalContainerCustom>
    )
}

export default CreateTaskGlobally

