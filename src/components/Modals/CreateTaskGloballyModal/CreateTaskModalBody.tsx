import { useContextCreateTaskModal } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal'
import { ReactNode, useEffect, useContext, useCallback, useRef } from 'react'
import DescriptionCreateTaskModal from './DescriptionCreateTaskModal'
import TaskTitleModal from './TaskTitleModal'
import TaskDetailMainContainer from '@/components/PageComponents/TaskDetail/TaskDetailMainContainer'
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useRecoilState } from '@/lib/state'
import { currentProjectAtom } from '@/store'
// import AssigneesContainerCreateTaskGlobally from './AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally'
import { useDeviceContext } from '@/lib/contexts/deviceContext'
import { ArrowLeft } from "lucide-react";
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { useContextCreateTaskInfoColumn } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn'
import TaskInfoColumnGloballyCreate from './TaskInfoColumnGloballyCreate'
import { TaskInfoColumnContainer } from '@/components/PageComponents/TaskDetail/MainPageComponents'
import ConfirmModal from '../Common Modals/ConfirmActionModal'
import { useTourContext } from '@/lib/contexts/TourContext'
import { DIV_ID_CONSTANTS } from '@/lib/configs/general.config'
import { KeyCodes } from '@/lib/constants/keyboard-handler'
import { armBackDismiss } from '@/lib/mobile/backDismiss'
import { usePathname } from 'next/navigation'
const Tooltip = dynamic(() => import("@/components/Common/Tooltip"), { ssr: false })
// const AssigneesContainerCreateTaskGlobally = dynamic(() => import("./AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally"), { ssr: false })
// const DescriptionCreateTaskModal = dynamic(()=>import("./DescriptionCreateTaskModal"),{ssr:false})

const attachmentButtonId = "create-task-modal-attachmentUpload"

interface IProps {
    children?: ReactNode
}

// =========== please fix how we get the sections later, right now i'm short on a deadline and i need to just get it done.
// not my proudest but no performance impacts, gets the job done.
// its just not clean is all
const CreateTaskModalBody: React.FC<IProps> = ({ }) => {
    const _mbl = useContext(MobileViewContext);
    const isApple = useDeviceContext()

    const { editMode, focusOn, setEditMode, setCurrentFocusedElement,
        currentFocusedElement, closeHandler,
        showAssignModal, setShowAssignModal, uploadInProgress, showConfirmationModal, onConfirmDiscard, onCancelDiscard,
        userInput: userPrompt, parentTaskInfo, isRecording, hasUnsavedChanges
    } = useContextCreateTaskModal()

    const {
        toggleMoveModal, toggleShowSizeModal, toggleDueDateModal,
        toggleShowTagsModal, togglePriorityModal, toggleProjectsModal,
    } = useContextCreateTaskInfoColumn()

    const { continueTourInModal, isTourActive, endTour } = useTourContext();

    const [_currentProject, __] = useRecoilState(currentProjectAtom)
    
    // Continue tour when modal opens if tour is active
    useEffect(() => {
        if (isTourActive()) {
            continueTourInModal();
        }
    }, []);
    const toggleModal = () => {
        setShowAssignModal((prev: boolean) => {
            if (prev) {
                setEditMode(null)
            }
            else setEditMode("assignees")
            return !prev
        })
    }


    const ArrowRightHandler = () => {
        // if (editMode) return
        setEditMode(null)
        switch (currentFocusedElement) {
            case "Title":
                focusOn("Description")
                // setEditMode("Description")
                break;
            case "Description":
                focusOn("Title")
                // setEditMode("title")
                break;
            default:
                focusOn("Title")
                // setEditMode("title")
                break;
        }
    }

    const toggleAssignModalHandler = (event: any) => {
        if (uploadInProgress) return;
        event.preventDefault()
        toggleModal()
    }


    const returnConditions = () => {
        const isInputFocused = [
            "input",
            "textarea",
            "textbox",
            "ProseMirror",
        ].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());
        const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";
        // if (editMode!=="assignees") return "allowTab"
        console.log("returning")
        return document.activeElement?.className === tipTapClassName || isInputFocused || showConfirmationModal
    }
    // ============================= [ENTER] handler
    const EnterHandler = useCallback(() => {
        if (currentFocusedElement === "Description" && editMode !== "Description-ai") {
            setEditMode("Description")
            document.getElementById("create-task-tiptap-description")?.focus()
        }

        else if (currentFocusedElement === "Title") {
            setEditMode("title")
            document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.focus()
        }
    }, [currentFocusedElement, setEditMode, editMode])


    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleKeyDown = (e: KeyboardEvent) => {
        // e.stopPropagation()
        // console.log("🚀 ~ handleKeyDown ~ e:", e)
        var cmdControl = isApple && e.metaKey || !isApple && e.ctrlKey;
        if (uploadInProgress) return toast("Upload in progress! Please wait")
        // console.log("document active el: ", document.activeElement)
        // const mode = editMode && ["title", "Description", "Description-ai"].includes(editMode) ? "Editing" : currentFocusedElement ? "Navigating" : "Modal"
        // console.log("🚀 ~ handleKeyDown ~ mode:", mode)
        // console.log("🚀 ~ handleKeyDown ~ currentFocusedElement:", currentFocusedElement)
        // console.log("🚀 ~ handleKeyDown ~ editMode:", editMode)


        // ============== keydown operations for when mode is "EDITING"

        if (showAssignModal) return

        if ((editMode === "Description" || editMode === "Description-ai") && userPrompt.length > 0) return
        if (returnConditions()) return
        if (e.key === "Tab") e.preventDefault()
        if (e.key === "Escape") closeHandler(false)
        if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.A) {
            e.preventDefault()
            document.getElementById(attachmentButtonId)?.click()
            setEditMode("Description")
            setCurrentFocusedElement("Description")
        }
        // [a]
        if (!e.shiftKey && !cmdControl && e.keyCode === KeyCodes.A) return toggleAssignModalHandler(e)

        // [p] for set priority
        if (e.keyCode === KeyCodes.P && !cmdControl) {
            e.preventDefault()
            return togglePriorityModal()
        }

        // [shift]+[d] for due date 
        if (e.keyCode === KeyCodes.D && !e.ctrlKey) {
            e.preventDefault()
            return toggleDueDateModal()
        }
        // [m]
        if (e.keyCode === KeyCodes.M && !cmdControl && !e.shiftKey) {
            e.preventDefault()
            return toggleMoveModal();
        }

        // [s] for size / estimate
        if (e.keyCode === KeyCodes.S) {
            e.preventDefault()
            return toggleShowSizeModal()

        }

        // [shift]+[m] for board/project 
        if (e.keyCode === 77 && !cmdControl && e.shiftKey) {
            e.preventDefault()
            return toggleProjectsModal()
        }

        // [t] 
        if (e.keyCode === KeyCodes.T) {
            e.preventDefault()
            return toggleShowTagsModal()
        }
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Tab") return ArrowRightHandler()
        if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) return ArrowRightHandler()
        if (e.key === "Enter" && !cmdControl) return EnterHandler()

        // [ctrl] + [d] []
        if (e.keyCode === KeyCodes.D && cmdControl) {
            e.preventDefault()
            setEditMode("Description")
            setCurrentFocusedElement("Description")
        }

        console.log("made it till here")

        // press [cmd/ctrl][j]
        if (e.keyCode === KeyCodes.J && cmdControl) {
            e.preventDefault()
            endTour()
            console.log("🚀 ~ handleKeyDown ~ endTour is not working");
            setEditMode("Description-ai")
            setCurrentFocusedElement("Description")
            return true
        }

        // [Audio button] cmd/ctrl + shift + d
        if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.D) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button"
            document.getElementById(elementId)?.click();
        }

        // [Audio button with improve] cmd/ctrl + shift + f
        if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.F) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button-improve"
            document.getElementById(elementId)?.click();
        }
            // [Audio button] alt+v
        if (e.altKey && e.keyCode === KeyCodes.V) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            document.getElementById("create-task-modal" + "-" + "audio-button")?.click();
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [editMode, showAssignModal, showConfirmationModal, closeHandler, ArrowRightHandler, currentFocusedElement, userPrompt]);

    // The mobile modal is full screen: no backdrop to tap, so the system back
    // gesture must dismiss it. Keep the latest handlers in a ref so the entry is
    // pushed once per open, not again on every keystroke.
    const isNewTaskPage = usePathname() === "/new"
    const backHandlersRef = useRef({ closeHandler, hasUnsavedChanges })
    backHandlersRef.current = { closeHandler, hasUnsavedChanges }

    useEffect(() => {
        // On the /new page the modal IS the route, so closing already navigates
        // and the browser's own back works. Arming there would pop twice.
        if (!_mbl || isNewTaskPage || typeof window === "undefined") return;
        return armBackDismiss(window, {
            key: "createTaskModal",
            onBack: () => backHandlersRef.current.closeHandler(false),
            // An unsaved draft opens the discard confirmation instead of
            // closing, so the modal is still up and back must keep working.
            shouldRearm: () => backHandlersRef.current.hasUnsavedChanges(),
        });
    }, [_mbl, isNewTaskPage]);

    // Warn user before closing tab/window if there are unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (hasUnsavedChanges()) {
                event.preventDefault();
                event.returnValue = ''; // Standard way to trigger the browser's default confirmation
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [hasUnsavedChanges]);

    return (
        <>
            <TaskDetailMainContainer 
            bodyClassName={_mbl ? 'overflow-y-auto': 'task-detail-horizontal-padding'}
            key={`project-${_currentProject?.id}`}>
                <BackButton />
                <TaskTitleModal />

                {parentTaskInfo && (
                    <span className="mt-0 px-2 pb-3 text-icon-dark-gray text-dense">
                        Sub-task of&nbsp;
                        <span
                            className="font-medium text-hypertasks-header-blue hover:underline cursor-pointer"
                            onClick={() => closeHandler(false)}
                        >
                            {parentTaskInfo.ticketNumber}
                            &nbsp;
                            {parentTaskInfo.title}
                        </span>
                    </span>
                )}
                <div
                    id="taskInfo_comments_description_container"
                    className={`  ${_mbl ?
                        "flex-col-reverse gap-2 xs:px-[18px] scrollbar-none  comments_description_container" : "mt-0 pl-1"} `}
                    style={{

                        display: "flex",
                        flex: 1,
                        width: "100%",
                    }}
                >

                    {/* ======================= Left half ================= */}
                    <DescriptionCreateTaskModal />
                    {/* ======================= Right half ================= */}

                    {/* ======================== task status ================== */}
                    <TaskInfoColumnContainer
                        heightVariant="fit"
                        // Keep the property rows at their natural height on mobile. The
                        // reversed flex column scrolls; shrinking this card instead made
                        // it look like a divider once the description/keyboard grew.
                        className={_mbl ? "shrink-0" : undefined}
                    >
                        <TaskInfoColumnGloballyCreate />
                    </TaskInfoColumnContainer>

                </div>
                {/* <SaveChanges/> */}

            </TaskDetailMainContainer>
            {showConfirmationModal && (
                <ConfirmModal
                    header='Discard Changes?'
                    content='Going back will discard all changes. Confirm if you want to go back'
                    confirmButtonContent='Discard Changes'
                    onConfirm={onConfirmDiscard}
                    onCancel={onCancelDiscard}
                    onTaskPage={true}
                />
            )}
        </>
    )
}

export default CreateTaskModalBody



// please for the love of lord, refactor this and you can make it reusabel so easily.
// im handling 3.5 fucking projects in one day, so i dont havce the energy. 
// just export it with these props.
// 1. onClickHandler
// 2. shouldShowToolTip
// 3. toolTip content.
const BackButton = () => {
    const { closeHandler } = useContextCreateTaskModal()

    return (
        <>

            <div
                className="fixed xs:hidden sm:flex gap-2  items-center  flex-col xl:flex-row xl:left-10 left-5"
                style={{
                    zIndex: 3,
                    top: 40,
                    justifyContent: "center",
                }}
            >
                <div
                    onClick={() => {
                        closeHandler(false)
                    }}
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                    }}
                    className="cursor-pointer justify-center items-center flex group bg-back-button shadow-md border-light-black-border-4"
                >
                    <ArrowLeft size={18} strokeWidth={1.75} className="text-button-arrow" />
                    <Tooltip
                        left={45}
                        bottom={2}
                        text='Back'
                        keyCombination={['ESC']}
                    />
                </div>
            </div>

            {/* The mobile Back pill is gone (HTPR-5147). It was fixed at bottom
                right and landed on top of the AI writer's send button, and the
                sheet already closes by dragging down or tapping the backdrop, so
                it cost a control and bought nothing. Desktop keeps its arrow. */}
        </>

    )
}
