import { ModalContainerCustom } from '@/components/Common/CommonModalComponents';
import React, { useContext } from 'react'
import type { CSSProperties } from 'react'
import styles from '@/styles/linksModal.module.scss'
import { useRecoilState } from '@/lib/state';
import { currentProjectAtom } from '@/store';
import { CreateTaskModalProvider } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal';
import CreateTaskModalBody from './CreateTaskModalBody';
import { CreateTaskInfoColumnProvider } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn';
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useFlag } from '@/hooks/useFlag';
import { HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG } from '@/lib/flags/definitions/htpr-8029-phone-new-task-layout';
import { useMobileVisualViewport } from '@/hooks/General/useMobileVisualViewport';
import { phoneNewTaskViewportOffsets } from '@/lib/phoneNewTaskSheet';
import { cn } from '@/utils/undoActions/helperFuncs';

interface IProps {
    shouldShow: boolean;
    closeCallback: () => void
}
const CreateTaskGlobally: React.FC<IProps> = ({ shouldShow, closeCallback }) => {
    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    const isMobile = useContext(MobileViewContext)
    const phoneNewTaskLayout = useFlag(HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG)
    const phoneLayout = Boolean(isMobile) && phoneNewTaskLayout
    const viewport = useMobileVisualViewport(Boolean(isMobile) && phoneNewTaskLayout)
    const { top, keyboard, keyboardOpen } = phoneNewTaskViewportOffsets(viewport)
    if (!shouldShow) return (<></>)
    return (
        <ModalContainerCustom
            id="createTaskModal"
            fullScreen={true}
            isOpen={shouldShow}
            keyboard={false}
            onOpened={() => { }}
            key={`create-task-modal-container-for-project:${_currentProject?.id}`}
            toggle={closeCallback}
            className={cn(
                styles.links_modal,
                "relative",
                Boolean(isMobile) && phoneNewTaskLayout && "phone-new-task-sheet",
                Boolean(isMobile) && phoneNewTaskLayout && keyboardOpen && "phone-new-task-keyboard",
            )}
            style={phoneLayout ? { "--phone-new-task-viewport-top": top, "--phone-new-task-keyboard": keyboard } as CSSProperties : undefined}
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

