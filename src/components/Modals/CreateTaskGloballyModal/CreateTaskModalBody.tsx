import { PlanLimitRefusal } from "@/lib/planLimitsClient";
import { useContextCreateTaskModal } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal'
import { ReactNode, useEffect, useContext, useCallback, useRef, useState } from 'react'
import DescriptionCreateTaskModal from './DescriptionCreateTaskModal'
import TaskTitleModal from './TaskTitleModal'
import TaskDetailMainContainer from '@/components/PageComponents/TaskDetail/TaskDetailMainContainer'
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useRecoilState } from '@/lib/state'
import { currentProjectAtom } from '@/store'
import { useDeviceContext } from '@/lib/contexts/deviceContext'
import { ArrowLeft, ChevronDown, X } from "lucide-react";
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { useContextCreateTaskInfoColumn } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn'
import TaskInfoColumnGloballyCreate from './TaskInfoColumnGloballyCreate'
import { TaskInfoColumnContainer } from '@/components/PageComponents/TaskDetail/MainPageComponents'
import ConfirmModal from '../Common Modals/ConfirmActionModal'
import { useTourContext } from '@/lib/contexts/TourContext'
import { DIV_ID_CONSTANTS } from '@/lib/configs/general.config'
import { KeyCodes } from '@/lib/constants/keyboard-handler'
import { armBackDismiss, closeBackDismissBeforeNavigation } from '@/lib/mobile/backDismiss'
import { usePathname, useRouter } from 'next/navigation'
import { useFlag } from '@/hooks/useFlag'
import { HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG, HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG } from '@/lib/flags/keys'
import { HTPR_8172_NEW_TASK_AI_NAVIGATION_FLAG } from '@/lib/flags/definitions/htpr-8172-new-task-ai-navigation'
const Tooltip = dynamic(() => import("@/components/Common/Tooltip"), { ssr: false })

const attachmentButtonId = "create-task-modal-attachmentUpload"

interface IProps {
    children?: ReactNode
}

const CreateTaskModalBody: React.FC<IProps> = ({ }) => {
    const _mbl = useContext(MobileViewContext);
    const isApple = useDeviceContext()

    const { editMode, focusOn, setEditMode, setCurrentFocusedElement,
        currentFocusedElement, closeHandler,
        showAssignModal, setShowAssignModal, uploadInProgress, showConfirmationModal, onConfirmDiscard, onCancelDiscard,
        userInput: userPrompt, parentTaskInfo, isRecording, hasUnsavedChanges,
        formValues, titleGenerationError, CreateTaskAndDescription, setUploadInProgress,
    } = useContextCreateTaskModal()
    const ctrlJSidebarOnNewTask = useFlag(HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG)
    const keepTaskAiNavigation = useFlag(HTPR_8172_NEW_TASK_AI_NAVIGATION_FLAG)
    const router = useRouter()
    const sidebarHandoffPending = useRef(false)
    useEffect(ctrlJSidebarOnNewTask ? () => {
        const openNewTaskSidebar = async (event: KeyboardEvent) => {
            const cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey)
            if (!document.getElementById("createTaskModal") || event.key.toLowerCase() !== "j" || !cmdControl || event.shiftKey || event.altKey || event.isComposing || isRecording || showAssignModal || showConfirmationModal) return
            if (document.activeElement?.closest("#htc, .chatwindow, [data-ai-chat-panel]") || document.querySelector("#htc")) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (event.repeat || sidebarHandoffPending.current || uploadInProgress) return
            if (!formValues.currentProject) return
            sidebarHandoffPending.current = true
            setUploadInProgress(true)
            try {
                const taskUrl = await CreateTaskAndDescription(undefined, formValues.title.trim() || "New Task")
                if (!taskUrl) throw new Error("Task could not be created")
                const closeBeforeNavigation = _mbl && window.location.pathname !== "/new"
                if (closeBeforeNavigation) await closeBackDismissBeforeNavigation(window, "createTaskModal", () => closeHandler(true))
                router.push(`${taskUrl}?newTaskAi=1`)
                if (!closeBeforeNavigation && (!keepTaskAiNavigation || window.location.pathname !== "/new")) closeHandler(true)
            } catch (error) {
                sidebarHandoffPending.current = false
                toast.error(error instanceof PlanLimitRefusal ? error.message : "Could not open AI chat. Your task draft is still here.")
            } finally {
                setUploadInProgress(false)
            }
        }
        window.addEventListener("keydown", openNewTaskSidebar, true)
        return () => window.removeEventListener("keydown", openNewTaskSidebar, true)
    } : () => {}, [ctrlJSidebarOnNewTask, keepTaskAiNavigation, _mbl, isApple, isRecording, showAssignModal, showConfirmationModal, uploadInProgress, formValues, CreateTaskAndDescription, setUploadInProgress, router, closeHandler])

    const {
        toggleMoveModal, toggleShowSizeModal, toggleDueDateModal,
        toggleShowTagsModal, togglePriorityModal, toggleProjectsModal,
    } = useContextCreateTaskInfoColumn()
    const descriptionFirstEnabled = useFlag(HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG)
    const descriptionFirstMobile = Boolean(_mbl && descriptionFirstEnabled)
    const [expandedMobileSection, setExpandedMobileSection] = useState<"title" | "properties" | null>(null)
    const descriptionFocusSet = useRef(false)

    const { continueTourInModal, isTourActive, endTour } = useTourContext();

    const [_currentProject, __] = useRecoilState(currentProjectAtom)
    
    useEffect(() => {
        if (isTourActive()) {
            continueTourInModal();
        }
    }, []);

    useEffect(() => {
        if (!descriptionFirstMobile) return
        if (!descriptionFocusSet.current) {
            descriptionFocusSet.current = true
            if (editMode === "Description-ai") return
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            return
        }
        if (titleGenerationError || currentFocusedElement === "Title") {
            setExpandedMobileSection("title")
        }
    }, [currentFocusedElement, descriptionFirstMobile, editMode, setCurrentFocusedElement, setEditMode, titleGenerationError])

    const toggleMobileSection = (section: "title" | "properties") => {
        const nextSection = expandedMobileSection === section ? null : section
        setExpandedMobileSection(nextSection)
        if (nextSection === "title") {
            setEditMode("title")
            setCurrentFocusedElement("Title")
        } else {
            setEditMode("Description")
            setCurrentFocusedElement("Description")
        }
    }

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
        setEditMode(null)
        switch (currentFocusedElement) {
            case "Title":
                focusOn("Description")
                break;
            case "Description":
                focusOn("Title")
                break;
            default:
                focusOn("Title")
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
        console.log("returning")
        return document.activeElement?.className === tipTapClassName || isInputFocused || showConfirmationModal
    }
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



    const handleKeyDown = (e: KeyboardEvent) => {
        var cmdControl = isApple && e.metaKey || !isApple && e.ctrlKey;
        if (uploadInProgress) return toast("Upload in progress! Please wait")

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
        if (!e.shiftKey && !cmdControl && e.keyCode === KeyCodes.A) return toggleAssignModalHandler(e)

        if (e.keyCode === KeyCodes.P && !cmdControl) {
            e.preventDefault()
            return togglePriorityModal()
        }

        if (e.keyCode === KeyCodes.D && !e.ctrlKey) {
            e.preventDefault()
            return toggleDueDateModal()
        }
        if (e.keyCode === KeyCodes.M && !cmdControl && !e.shiftKey) {
            e.preventDefault()
            return toggleMoveModal();
        }

        if (e.keyCode === KeyCodes.S) {
            e.preventDefault()
            return toggleShowSizeModal()

        }

        if (e.keyCode === 77 && !cmdControl && e.shiftKey) {
            e.preventDefault()
            return toggleProjectsModal()
        }

        if (e.keyCode === KeyCodes.T) {
            e.preventDefault()
            return toggleShowTagsModal()
        }
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Tab") return ArrowRightHandler()
        if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) return ArrowRightHandler()
        if (e.key === "Enter" && !cmdControl) return EnterHandler()

        if (e.keyCode === KeyCodes.D && cmdControl) {
            e.preventDefault()
            setEditMode("Description")
            setCurrentFocusedElement("Description")
        }

        console.log("made it till here")

        if (e.keyCode === KeyCodes.J && cmdControl) {
            e.preventDefault()
            endTour()
            console.log("🚀 ~ handleKeyDown ~ endTour is not working");
            setEditMode("Description-ai")
            setCurrentFocusedElement("Description")
            return true
        }

        if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.D) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button"
            document.getElementById(elementId)?.click();
        }

        if (e.shiftKey && cmdControl && e.keyCode === KeyCodes.F) {
            e.preventDefault();
            if (isRecording) return;
            setEditMode("Description")
            setCurrentFocusedElement("Description")
            let elementId = "create-task-modal-audio-button-improve"
            document.getElementById(elementId)?.click();
        }
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

    const isNewTaskPage = usePathname() === "/new"
    const backHandlersRef = useRef({ closeHandler, hasUnsavedChanges })
    backHandlersRef.current = { closeHandler, hasUnsavedChanges }

    useEffect(() => {
        if (!_mbl || isNewTaskPage || typeof window === "undefined") return;
        return armBackDismiss(window, {
            key: "createTaskModal",
            onBack: () => backHandlersRef.current.closeHandler(false),
            shouldRearm: () => backHandlersRef.current.hasUnsavedChanges(),
        });
    }, [_mbl, isNewTaskPage]);

    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (hasUnsavedChanges()) {
                event.preventDefault();
                event.returnValue = '';
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
                {descriptionFirstMobile && (
                    <div
                        data-mobile-description-first-header
                        className="sticky top-0 z-50 flex w-full flex-col gap-2 border-b border-light-black-border-1 bg-taskDetal-container px-4 pb-3 pt-3"
                    >
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={toggleProjectsModal}
                                className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-[4px] bg-comment-description px-3 text-left text-content text-white-black"
                            >
                                <span className="shrink-0 text-text-light-gray">Board:</span>
                                <strong className="truncate">{formValues.currentProject?.title ?? "Choose board"}</strong>
                                <ChevronDown className="ml-auto shrink-0" size={16} strokeWidth={1.5} aria-hidden />
                            </button>
                            <button
                                type="button"
                                aria-label="Close new task"
                                onClick={() => closeHandler(false)}
                                className="flex h-11 w-11 shrink-0 items-center justify-center text-icon-dark-gray"
                            >
                                <X size={18} strokeWidth={1.5} aria-hidden />
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                aria-expanded={expandedMobileSection === "title"}
                                onClick={() => toggleMobileSection("title")}
                                className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-[4px] bg-cardBackground px-3 text-left text-content text-white-black"
                            >
                                <span className="shrink-0 text-text-light-gray">Title:</span>
                                <strong className="truncate">{formValues.title.trim() || "Add"}</strong>
                                <ChevronDown className="ml-auto shrink-0" size={16} strokeWidth={1.5} aria-hidden />
                            </button>
                            <button
                                type="button"
                                aria-expanded={expandedMobileSection === "properties"}
                                onClick={() => toggleMobileSection("properties")}
                                className="flex min-h-11 flex-1 items-center justify-between rounded-[4px] bg-cardBackground px-3 text-content font-semibold text-white-black"
                            >
                                Properties
                                <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
                            </button>
                        </div>
                    </div>
                )}
                <div className={descriptionFirstMobile && expandedMobileSection !== "title" ? "hidden" : "contents"}>
                    <TaskTitleModal mobileCompact={descriptionFirstMobile} mobileTitleVisible={!descriptionFirstMobile || expandedMobileSection === "title"} />
                </div>

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
                        "flex-col gap-2 xs:px-[18px] scrollbar-none  comments_description_container" : "mt-0 pl-1"} `}
                    style={{

                        display: "flex",
                        flex: 1,
                        width: "100%",
                    }}
                >

                    {_mbl && (descriptionFirstMobile ? (
                        <TaskInfoColumnGloballyCreate
                            mobileHideBoard
                            mobileShowPills={expandedMobileSection === "properties"}
                            mobileRaisedPanel
                        />
                    ) : (
                        <TaskInfoColumnContainer
                            heightVariant="fit"
                            className="shrink-0"
                        >
                            <TaskInfoColumnGloballyCreate />
                        </TaskInfoColumnContainer>
                    ))}
                    <DescriptionCreateTaskModal />

                    {!_mbl && (
                        <TaskInfoColumnContainer heightVariant="fit">
                            <TaskInfoColumnGloballyCreate />
                        </TaskInfoColumnContainer>
                    )}

                </div>

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

const BackButton = () => {
    const { closeHandler } = useContextCreateTaskModal()

    return (
        <>

            <div
                data-testid="new-task-back"
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

        </>

    )
}
