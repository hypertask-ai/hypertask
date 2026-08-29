import Tooltip from '@/components/Common/Tooltip'
import { ClickableSpan, LocalRightSideInfo, TaskInfoRow, TaskInfoValue } from '@/components/PageComponents/TaskDetail/MainPageComponents'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { useContextCreateTaskInfoColumn } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskGloballyInfoColumn'
import { useContextCreateTaskModal } from '@/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal'
import { ILabel, IProject, ISection } from '@/models/model'
import { currentProjectAtom, showCreateTaskModalAtom } from '@/store'
import React, { Suspense, useContext, useEffect, useRef } from 'react'
import { useRecoilState } from '@/lib/state'
import MoveToColumn from '../commands/moveToColumn'
import PriorityLabelComponent from '../TaskPriority/PriorityLabelComponent'
import { EstimateConstants, IEstimateConstants, IPrioritiesConstants } from '@/lib/constants/constants'
import SetPriorityModal from '../TaskPriority'
import TaskEstimateModal from '../TaskEstimate/TaskEstimate'
import DueDateLabel from '@/components/Labels/DueDateLabel'
import DueDateModal from '../DueDate'
import TaskLabelComponent from '../CreateLabel/TaskLabelComponent'
import CreateLabel from '../CreateLabel/CreateLabel'
import SetProjectsModal from '../SetProjectModal/SetProjectModal'
import AssigneesContainerCreateTaskGlobally from './AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally'

const TaskInfoColumnGloballyCreate = () => {
    const {
        toggleMoveModal, showMoveModal, setShowMoveModal,
        showPriorityModal, togglePriorityModal, toggleShowSizeModal,
        showSizeModal,
        toggleDueDateModal,
        showDueDateModal,
        toggleShowTagsModal,
        showTagsModal, showProjectsModal, 
        toggleProjectsModal, 
    } = useContextCreateTaskInfoColumn()
    const { formValues, handleChange, allProjects, handleProjectChange,showAssignModal, setShowAssignModal, setEditMode  } = useContextCreateTaskModal()
    const _mbl = useContext(MobileViewContext);
    const [_currentProject, __] = useRecoilState(currentProjectAtom)
    const [createTaskModal] = useRecoilState(showCreateTaskModalAtom)

    // "Copy task to another board" opens the duplicate prefilled and lands straight on the board picker.
    // Wait for the boards to load first — SetProjectsModal snapshots allProjects on mount.
    const autoOpenedBoardPicker = useRef(false)
    useEffect(() => {
        if (!createTaskModal.duplicate?.pickBoard) return
        if (autoOpenedBoardPicker.current || allProjects.length === 0) return
        autoOpenedBoardPicker.current = true
        toggleProjectsModal()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allProjects.length])

    const callbackForMoveModal = (section: ISection) => {
        setShowMoveModal(false)
        handleChange("status", { sectionId: section.id, sectionTitle: section.section_title, sectionIdx: 0 })
    }

    const priorityHandler = (param?: IPrioritiesConstants) => {
        if (param?.priority_index === 0) handleChange("priority", undefined)
        else handleChange("priority", param)
        togglePriorityModal()
    }

    const setProjectHandler = (project?: IProject) =>{
        if(project) handleProjectChange(project)
        toggleProjectsModal()
    }

    const estimateHandler = (param?: IEstimateConstants) => {
        if (param?.estimate_index === 0) handleChange("estimate", undefined)
        else handleChange("estimate", param)
        toggleShowSizeModal()
    }
    const labelsHandler = (param?: ILabel) => {
        console.log("🚀 ~ labelsHandler ~ param:", param);
        toggleShowTagsModal();

        if (!param) return; // Early return if param is undefined
    
        const previousState = formValues.tags??[];
        // Check if the label already exists in the previous state
        const index = previousState.findIndex(tag => tag.id === param.id);
    
        if (index !== -1) {
            // If it exists, remove it
            previousState.splice(index, 1);
        } else {
            // If it doesn't exist, add it
            previousState.push(param);
        }
        handleChange("tags",previousState)
    };

    const toggleAssigneeModal = () => {
        setShowAssignModal((prev: boolean) => {
            if (prev) {
                setEditMode(null)
            }
            else setEditMode("assignees")
            return !prev
        })
    }

    
    const dueDateHandler = (callback: Date | null, reset?: boolean) => {
        toggleDueDateModal()
        if (callback) handleChange("dueDate", callback)
        else if (reset) handleChange("dueDate", undefined)
    }
    // const priorityHandler = (param?:IPrioritiesConstants)=>{
    //     if (param?.priority_index===0) handleChange("priority",undefined)
    //     else  handleChange("priority", param)
    //     togglePriorityModal()
    // }
    return (
        <>
            <TaskInfoRow>
                            <AssigneesContainerCreateTaskGlobally
                                showModal={showAssignModal}
                                toggleModal={toggleAssigneeModal}
                            />
                        </TaskInfoRow>
            <TaskInfoRow>
                <>
                    <LocalRightSideInfo
                    //toggle showallprojects modal
                        onClick={toggleProjectsModal}
                        title="Project"
                        left={-44}
                        bottom={-40}
                        tooltipText="Change Project"
                        key={"Project"}
                        KeyCombination={['SHIFT','M']}
                    />

                    <TaskInfoValue
                        onClick={toggleProjectsModal}
                        className={`${_mbl ? "text-white-black" : "w-full cursor-pointer"} group w-full`}
                    >
                        <ClickableSpan title={formValues.currentProject?.title ?? "TBD"} />
                        <Tooltip
                            left={-44}
                            bottom={-40}
                            text='Change Project'
                            keyCombination={['SHIFT','M']}
                        />
                    </TaskInfoValue>
                </>
            </TaskInfoRow>
            <TaskInfoRow>
                <>
                    <LocalRightSideInfo
                        onClick={toggleMoveModal}
                        title="Status"
                        left={-44}
                        bottom={-40}
                        tooltipText="Change Status"
                        key={"Status"}
                        KeyCombination={['M']}
                    />

                    <TaskInfoValue
                        onClick={toggleMoveModal}
                        className={`${_mbl ? "text-white-black" : "w-full cursor-pointer"} group w-full`}
                    >
                        <ClickableSpan title={formValues.status?.sectionTitle ?? "TBD"} />
                        <Tooltip
                            left={-44}
                            bottom={-40}
                            text='Change status'
                            keyCombination={['M']}
                        />
                    </TaskInfoValue>
                </>
            </TaskInfoRow>

            {/* ====================================== TASK DUE DATE ================================ */}
            <TaskInfoRow>
                <LocalRightSideInfo
                    onClick={toggleDueDateModal}
                    title="Due date"
                    left={-44}
                    bottom={-40}
                    tooltipText="Set due date"
                    key={"due date"}
                    KeyCombination={["D"]}
                />

                <TaskInfoValue
                    onClick={() => toggleDueDateModal()}
                    className="cursor-pointer group"
                >
                    <Tooltip
                        left={0}
                        bottom={-40}
                        text='Set due date'
                        keyCombination={["D"]}
                    />
                    <Suspense fallback={<></>}>
                        {
                            formValues.dueDate ?
                                <DueDateLabel
                                    stopPropogation={true}
                                    flexBasis={false}
                                    fontWeight={500}
                                    onClick={toggleDueDateModal}
                                    dueDate={formValues.dueDate}
                                    isTaskInfo={true}
                                />
                                :
                                <ClickableSpan title={"-"} />
                        }
                    </Suspense>
                </TaskInfoValue>
            </TaskInfoRow>

            <TaskInfoRow>
                <LocalRightSideInfo
                    onClick={togglePriorityModal}
                    title="Priority"
                    left={-44}
                    bottom={-40}
                    tooltipText="Set priority"
                    key={"priority"}
                    KeyCombination={['P']}
                />

                <TaskInfoValue
                    onClick={() => togglePriorityModal()}
                    className="cursor-pointer group"
                >
                    <Tooltip
                        left={-44}
                        bottom={-40}
                        text='Set priority'
                        keyCombination={['P']}
                    />
                    <Suspense fallback={<></>}>

                        {formValues.priority ?
                            <PriorityLabelComponent
                                stopPropogation={false}
                                priority={formValues.priority} />

                            :

                            <ClickableSpan title="No Priority" />
                        }
                    </Suspense>
                </TaskInfoValue>
            </TaskInfoRow>

            {/* ====================================== TASK Estimate ================================ */}
            <TaskInfoRow>
                <LocalRightSideInfo
                    onClick={toggleShowSizeModal}
                    title="Task size"
                    left={-44}
                    bottom={-40}
                    tooltipText="Set task size"
                    key={"task size"}
                    KeyCombination={['S']}
                />

                <TaskInfoValue
                    onClick={() => toggleShowSizeModal()}
                    className="cursor-pointer group"
                >
                    <Tooltip
                        left={-44}
                        bottom={-40}
                        text='Set task size'
                        keyCombination={['S']}
                    />
                    <Suspense fallback={<></>}>
                        <ClickableSpan title={(formValues.estimate ? EstimateConstants.find(x => x.estimate_index === formValues.estimate?.estimate_index)?.estimate_full_value : "-") ?? "-"} />
                    </Suspense>
                </TaskInfoValue>
            </TaskInfoRow>
            {/* ====================================== TASK Labels ================================ */}
            <TaskInfoRow alignTop>
                <LocalRightSideInfo
                    onClick={toggleShowTagsModal}
                    title="Tags"
                    left={-44}
                    bottom={-40}
                    tooltipText="Set tags"
                    key={"tags"}
                    KeyCombination={['T']}
                />

                {
                    formValues.tags && formValues.tags.length > 0 ?
                        <TaskInfoValue
                            onClick={() => toggleShowTagsModal()}
                            className="flex flex-wrap gap-2 cursor-pointer group"
                        >

                            {
                                formValues.tags?.map((taskLabel: ILabel, index: any) =>

                                    <>
                                        <TaskLabelComponent
                                            flexBasis={false}
                                            stopPropogation={false}
                                            labelValue={taskLabel.value} />

                                    </>
                                )

                            }
                        </TaskInfoValue>
                        :
                        <TaskInfoValue
                            onClick={() => toggleShowTagsModal()}
                            className="text-start cursor-pointer group"
                        >
                            <ClickableSpan title="No tags" />
                            <Tooltip
                                left={-44}
                                bottom={-40}
                                text='Set tags'
                                keyCombination={['T']}
                            />
                        </TaskInfoValue>
                }

            </TaskInfoRow>


            {showTagsModal && <CreateLabel previouslyAddedFilters={formValues.tags??[]} mode="CreateTaskGlobally" closeHandlerForCreateNewTask={labelsHandler} currentProject={formValues.currentProject}/>}
            {showSizeModal && <TaskEstimateModal mode="TaskModalGlobally" closeHandler={estimateHandler} />}
            {_currentProject && showMoveModal && <MoveToColumn mode='CreatingTask' callback={callbackForMoveModal} projectId={formValues.currentProject?.id!} moveTaskToColumnHandler={toggleMoveModal} />}
            {showPriorityModal && <SetPriorityModal mode="TaskModalGlobally" closeHandler={priorityHandler} />}
            {showDueDateModal && <DueDateModal dueDate={formValues.dueDate} mode={'Create'} closeHandler={dueDateHandler} />
            }
            {showProjectsModal && <SetProjectsModal toggle={setProjectHandler} currentProject={formValues.currentProject} allProjects={allProjects}/>}
        </>
    )
}

export default TaskInfoColumnGloballyCreate
