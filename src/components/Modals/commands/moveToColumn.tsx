import { IComment, IProjectsAll, ISection, ITask } from "@/models/model";
import { useEffect, useRef, useState, useCallback } from "react";
import { ModalBody } from "reactstrap";
import styles from '@/styles/linksModal.module.scss'

import { EyeOff } from "lucide-react";
import { useRecoilState } from "@/lib/state";
import { activeItemAtom } from "@/store";
import { useGetSectionsMoveTask } from "@/hooks/MultiPages/useGetSectionsMoveTask";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import generateRanking from "@/utils/generateRank";
import toast from "react-hot-toast";
import {
  LEARN_TUTORIAL_COLUMN_MOVE_EVENT,
  type LearnTutorialColumnMoveDetail,
} from "@/lib/tutorial/learnTutorialState";

type TaskIdentity = {
  taskId: number;
  projectId: number;
  sectionId: number | null;
};

type Props = {
  projectId: number;
  moveTaskToColumnHandler: (flag?: boolean) => void,
  callback?: (section: ISection) => void;
  taskCacheCallback?: (newComment: IComment) => void;
  title?: string;
  bulkTaskIds?: number[];
  onBulkMove?: (section: ISection) => Promise<void>;
} & (
  | { mode: "CreatingTask"; task?: never }
  | { mode?: "Others"; task: TaskIdentity }
);
const MoveToColumn: React.FC<Props> = ({ mode = "Others", moveTaskToColumnHandler, projectId, task, callback, taskCacheCallback, title = "Move task to column", bulkTaskIds, onBulkMove }) => {

  const [___, setActiveItem] = useRecoilState(activeItemAtom);
  const queryClient = useQueryClient();
  const taskIdentity = useRef(task).current;
  const taskProjectId = taskIdentity?.projectId ?? projectId;

  // --------------- Refs
  const columnsInputRef = useRef<HTMLInputElement>(null)

  // ---------------- state handlers
  const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [modal, _] = useState<boolean>(true);
  const { removeFromListWithStatus, moveItem } = UpdateKanban();

  // ---------------- ColumnsToDisplay 
  const [filteredColumns, setFilteredColumns] = useState<ISection[]>([])
  const [sections, setColumns] = useState<ISection[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })

  // --------------- React-Query hook
  const { data: sectionsForProjectTQ, isFetched } = useGetSectionsMoveTask(["moveTaskModal", taskProjectId], taskProjectId)

  // -------------------- input handlers
  const [inputValue, setInputValue] = useState<string>("");
  const handleChange = (e: any) => {
    setInputValue(e.target.value)

    setFilteredColumns((prev) => sections.filter((section: ISection) =>
      e.target.value
        ? section.section_title?.toLowerCase().includes(e.target.value.toLowerCase())
        : true
    ))
  }

  const handleToggle = () => {
    // setModal(!modal)
    moveTaskToColumnHandler(true)
  }

  useEffect(() => {
    columnsInputRef.current?.focus();
    setColumns(sectionsForProjectTQ);
    setFilteredColumns(sectionsForProjectTQ);
    if (taskIdentity) {
      console.log("🚀 ~ useEffect ~ sectionId:", taskIdentity.sectionId);
      requestAnimationFrame(() => {
        const columnIndex = sectionsForProjectTQ.findIndex(
          (section: ISection, index: number) =>
            section.id === taskIdentity.sectionId
        );
        if (columnIndex !== -1) {
          setSelectedIndex(columnIndex);

          const element = document.getElementById(`task_${sectionsForProjectTQ[columnIndex].id}`);
          const container = document.getElementById("users-list");
          
          if (element && container) {
            // Direct scrollTop manipulation - faster than scrollIntoView
            const elementTop = element.offsetTop;
            const containerHeight = container.clientHeight;
            const elementHeight = element.clientHeight;
            container.scrollTop = elementTop - (containerHeight) + (elementHeight);
          }
        }
      });
    } else {
      setSelectedIndex(0);
    }
    setLoading(false);
  }, [sectionsForProjectTQ, taskIdentity]);
  // -------------------- ON MODAL LOAD
  const onOpenHandler = async () => {
    // setLoading(true)
    enableKeyboardControls(true) // force focus on input field
  }

  // if clicked in task creating mode
  const handleCreateTaskGloballyClick = (section: ISection) => {
    callback && callback(section)
  }

  const { mutate: moveTask } = useMutation({
    mutationFn: async ({ section, ranking }: { section: ISection; ranking?: string }) => {
      if (!taskIdentity) throw new Error("Unable to find task");
      const response = await fetch(`/api/tasks/moveTask`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: taskIdentity.projectId,
          taskId: taskIdentity.taskId,
          section_title: section.section_title,
          sectionId: section.id,
          section: section.section_title,
          ranking,
        }),
      });
      if (!response.ok) throw new Error("Unable to move task");
      return response.json();
    },
    onMutate: async ({ section }) => {
      if (!taskIdentity) throw new Error("Unable to find task");
      const taskId = taskIdentity.taskId;
      const sourceSectionId = taskIdentity.sectionId;
      const taskProjectId = taskIdentity.projectId;

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projectsAll"] }),
        queryClient.cancelQueries({ queryKey: ["task-", taskId] }),
      ]);

      const previousProjects = queryClient.getQueryData<IProjectsAll>(["projectsAll"]);
      const previousTask = queryClient.getQueryData<ITask>(["task-", taskId]);
      const previousSection = sectionsForProjectTQ.find(
        (candidate: ISection) => candidate.id === sourceSectionId
      );
      const movedTask = previousProjects?.updatedProjects
        .find((project) => project.id === taskProjectId)
        ?.sections.flatMap((projectSection) => projectSection.items)
        .find((task) => task.id === taskId);

      callback?.(section);
      queryClient.setQueryData<ITask>(["task-", taskId], (current) =>
        current && !Array.isArray(current)
          ? {
              ...current,
              sectionId: section.id,
              section: section.section_title,
            }
          : current
      );

      if (sourceSectionId && taskProjectId && taskId) {
        if (!section.visibility) {
          await removeFromListWithStatus(
            sourceSectionId,
            taskProjectId,
            taskId,
            "Move"
          );
          setActiveItem(null);
        } else if (section.id) {
          await moveItem(
            {
              destinationSectionId: section.id,
              itemId: taskId,
              sourceSectionId,
            },
            {
              persistRanking: false,
              refetchIfMissing: false,
              showToast: false,
            }
          );
        }
      }

      moveTaskToColumnHandler(true);
      document
        .getElementById("droppable-section-container-" + section.id)
        ?.scrollTo({ top: 0 });

      return { movedTask, previousProjects, previousSection, previousTask, taskId };
    },
    onSuccess: (data, { section }, context) => {
      if (data.newComment) taskCacheCallback?.(data.newComment);
      if (taskIdentity && typeof section.id === "number") {
        window.dispatchEvent(
          new CustomEvent<LearnTutorialColumnMoveDetail>(
            LEARN_TUTORIAL_COLUMN_MOVE_EVENT,
            {
              detail: {
                fromSectionId: taskIdentity.sectionId,
                projectId: taskIdentity.projectId,
                taskId: taskIdentity.taskId,
                toSectionId: section.id,
                title: section.section_title,
              },
            }
          )
        );
      }
      if (section.visibility && context?.movedTask) {
        toast(
          `${context.movedTask.ticketNumber?.toUpperCase()} has been moved to ${section.section_title}`
        );
      }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(["projectsAll"], context?.previousProjects);
      queryClient.setQueryData(["task-", context?.taskId], context?.previousTask);
      if (context?.previousSection) callback?.(context.previousSection);
      if (context?.taskId) setActiveItem(context.taskId);
    },
    onSettled: async (_data, _error, _variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["task-", context?.taskId] }),
      ]);
    },
  });
  // ---------------------- LINK CLICK HANDLER ------------------

  const handleLinkClick = useCallback(
    async (section: ISection) => {
      if (mode === "CreatingTask" && callback)
        return handleCreateTaskGloballyClick(section);

      if (bulkTaskIds?.length && onBulkMove) {
        setLoading(true);
        try {
          await onBulkMove(section);
        } finally {
          setLoading(false);
          handleToggle();
        }
        return;
      }

      if (!taskIdentity) return;
      console.log(
        "🚀 ~ handleLinkClick ~ sectionToMoveID & fromSectionID",
        section.id,
        taskIdentity.sectionId
      );
      const projects = queryClient.getQueryData<IProjectsAll>(["projectsAll"]);
      const destinationSection = projects?.updatedProjects
        .find((project) => project.id === taskIdentity.projectId)
        ?.sections.find((projectSection) => projectSection.sectionId === section.id);
      const ranking = generateRanking(
        undefined,
        destinationSection?.items[0]?.ranking
      );
      moveTask({ section, ranking });
    },
    [
      callback,
      mode,
      bulkTaskIds,
      onBulkMove,
      moveTask,
      queryClient,
      taskIdentity,
    ]
  );

  //  ============================= KEYBOARD NAVIGATION HANDLER =============================

  const handleKeyDown = (event: any) => {
    // console.log('im working at least')
    const selectedUrl = filteredColumns[selectedIndex]
    // ------------------------------ DOWN MOVEMENT ------------------------------
    if (!selectedUrl) return 
    if (event.key === "ArrowDown") {
      // down
      if (selectedUrl) {

        // ------ at bottom of list
        if (selectedIndex === -1 || selectedIndex === (filteredColumns.length - 1)) {
        } else {
          setSelectedIndex((prev)=>prev+1)
          document.getElementById(`task_${filteredColumns[selectedIndex + 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        if (filteredColumns.length > 0) {
          setSelectedIndex(0)
          document.getElementById(`task_${filteredColumns[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      return true
      // ------------------------------ UP MOVEMENT ------------------------------
    }
    else if (event.key === "ArrowUp") {
      // up
      if (selectedUrl) {

        // ------ at top of list
        if (selectedIndex <= 0) {
          // setSelectedUrl(Columns[Columns.length - 1])
          // document.getElementById(`task-${Columns[Columns.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else {
          setSelectedIndex(prev=>prev-1)
          document.getElementById(`task_${filteredColumns[selectedIndex - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        if (sections.length > 0) {
          setSelectedIndex(sections.length - 1)
          document.getElementById(`task_${filteredColumns[sections.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      return true
    }
    else if (event.key === "Enter" && selectedUrl) {
      handleLinkClick(selectedUrl)
      return true
    }
    return false

  }
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [filteredColumns, selectedIndex]);

  // whenever filteredColumns Update, set current url as first
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredColumns]);

  return (
    <>
  
        <ModalContainerCustom
          id="MoveModal"
          isOpen={modal}
          onOpened={onOpenHandler}
          // autoFocus={false} 
          toggle={handleToggle}
          className={`paletteModalSizing sm:min-w-[560px] sm:top-[24%] ${styles.links_modal}`}>
          <ModalHeaderComp header={title} />

          <ModalBody className='p-0 rounded-b-[4px]'>
            <ModalInput
              id='linksModal'
              placeholder="Search Column"
              ref={columnsInputRef}
              value={inputValue}
              onChange={handleChange}
            />
            <ModalListContainer className="max-h-[364px]"
              handleMouseMove={handleMouseMove}
              id="users-list"
              aria-labelledby="assignDelayButton"
            >
              {
                sections &&
                filteredColumns
                  ?.filter((section: ISection) =>
                    inputValue
                      ? section.section_title?.toLowerCase().includes(inputValue.toLowerCase())
                      : true
                  )

                  .map((section: ISection, index: number) => (
                    <ModalRowElementContainer
                      id={`task_${section.id}`}
                      index={index}
                      handleMouseLeave={handleMouseLeave}
                      onMouseEnter={() => handleMouseEnter(index)}
                      key={`user-${index}`}
                      onClick={() => handleLinkClick(section)}
                      isSelected={selectedIndex === index}
                    >
                      <span className={`${styles.links_list}`}>
                        {section.section_title}
                      </span>
                      {section.visibility === false && <EyeOff size={16} strokeWidth={1.75} />}
                    </ModalRowElementContainer>
                  ))
              }
            </ModalListContainer>

          </ModalBody>
        </ModalContainerCustom>
      
    </>
  );
}

export default MoveToColumn;
