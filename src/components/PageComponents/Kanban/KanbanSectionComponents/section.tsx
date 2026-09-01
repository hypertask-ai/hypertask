/* eslint-disable react/jsx-key */
/* eslint-disable react-hooks/exhaustive-deps */
import dynamic from "next/dynamic";
import { getViewAppliedArchivedTasks } from "@/utils/helperFunctions/Views/ArchivedTasksHelper";
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
const loadTask = () => import("../KanbanTaskComponents/task");
const Task = dynamic(loadTask, {
  ssr: false,
  loading: () => <TaskSkeleton />,
});
import { currentProjectAtom, activeItemAtom, activeSectionAtom, activeSectionIdAtom, showCommandsAtom, isActiveSectionSelector, tasksPlayListAtom } from "@/store";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { Draggable, Droppable, type DraggableProvided } from "@hello-pangea/dnd";
// const Droppable = dynamic(()=>import("@hello-pangea/dnd").then(x=>x.Droppable));

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import NewTaskButton from "@/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton";
import useSections from "@/hooks/Homepage/useSections";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
// import ManageColumns from "@/components/Modals/commands/manageColumn";
import "@/styles/kanban/column.scss";
import globalConstants from "@/lib/constants";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { ISection, ITask, IUser } from "@/models/model";
import {
  sortingModeLabel,
  TBoardSortingViewMode,
  TBoardSubtaskSetting,
} from "@/models/Views/model";
import { CommandMode } from "@/models/enums";
import ProgressiveTaskPlaceholder from "../KanbanTaskComponents/ProgressiveTaskPlaceholder";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import {
  getMobileSectionObserverOptions,
  getProgressiveTaskRenderMode,
  shouldWarmInitialBoardTasks,
} from "@/lib/boardStartup/mobileProgressiveRendering";

export const LARGE_BOARD_PROGRESSIVE_RENDER_THRESHOLD = 40;
const INITIAL_PROGRESSIVE_TASKS_PER_SECTION = 2;
const PROGRESSIVE_REVEAL_SETTLE_MS = 160;

// Task skeleton component to prevent CLS
const TaskSkeleton = ({ provided }: { provided?: DraggableProvided }) => {
  return (
    <div
      ref={provided?.innerRef}
      {...provided?.draggableProps}
      style={provided?.draggableProps.style}
      className="outline-none rounded-[5px] xs:border-[1px] md:border-none xs:border-light-black-border-1"
    >
      <div className="shadow-md border-l-4 border-transparent bg-cardBackground rounded-[5px] outline-none min-h-[100px]">
        <div className="flex items-start p-2 gap-2 flex-col animate-pulse">
          {/* Task top row skeleton */}
          <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-16 h-3 bg-gray-300 dark:bg-gray-600 rounded"></div>
              <div className="w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
            </div>
            <div className="flex gap-1">
              <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
              <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
            </div>
          </div>

          {/* Title skeleton */}
          <div className="w-full flex-1">
            <div className="w-4/5 h-4 bg-gray-300 dark:bg-gray-600 rounded mb-2"></div>
            <div className="w-3/5 h-3 bg-gray-300 dark:bg-gray-600 rounded"></div>
          </div>

          {/* Tags row skeleton */}
          <div className="w-full flex gap-2 mt-2">
            <div className="w-12 h-5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
            <div className="w-16 h-5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
            <div className="w-14 h-5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section = ({
  section,
  moveItemUp,
  updateAssignees,
  index,
  moveItemDown,
  moveItemLeft,
  moveItemRight,
  markAsDone,
  archiveNotification,
  currentSetting,
  activeSortingMode,
  archivedTasks,
  showArchivedOnBoard,
  hiddenBySearch = false,
  dragHandleProps,
  draggableProps,
  draggableInnerRef,
  membersById,
  progressiveRendering,
  renderAllTasks,
  dragDisabled = false,
}: {
  section: ISection;
  currentSetting: TBoardSubtaskSetting;
  archivedTasks?: ITask[];
  showArchivedOnBoard?: boolean;
  archiveNotification: (sectionId: number, itemId: number) => void;
  updateAssignees: (sectionId: number, itemId: number, assignees?: any) => void;
  moveItemUp: (sectionId: number, itemId: number) => Promise<void>;
  moveItemDown: (sectionId: number, itemId: number) => Promise<void>;
  moveItemLeft: (sectionId: number, itemId: number) => Promise<void>;
  moveItemRight: (sectionId: number, itemId: number) => Promise<void>;
  markAsDone: (section: string, itemId: number, parentTask?: ITask) => void;
  index: number;
  hiddenBySearch?: boolean;
  activeSortingMode: TBoardSortingViewMode;
  dragHandleProps?: DraggableProvided["dragHandleProps"];
  draggableProps?: DraggableProvided["draggableProps"];
  draggableInnerRef?: DraggableProvided["innerRef"];
  membersById: Map<number, IUser>;
  progressiveRendering: boolean;
  renderAllTasks: boolean;
  dragDisabled?: boolean;
}) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const activeItem = useRecoilValue(activeItemAtom);
  const active = useRecoilValue(isActiveSectionSelector(index));
  const setActiveSection = useSetRecoilState(activeSectionAtom);
  const setActiveSectionId = useSetRecoilState(activeSectionIdAtom);
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const { navigateToTask } = useHypertasksNavigate();
  const [revealedTaskIds, setRevealedTaskIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [taskModuleReady, setTaskModuleReady] = useState(false);
  const [taskModuleFailed, setTaskModuleFailed] = useState(false);
  const [mobileSectionNearViewport, setMobileSectionNearViewport] = useState(
    index === 0,
  );
  const pendingFocusTaskId = useRef<number | null>(null);
  const intersectingTaskIds = useRef<Set<number>>(new Set());
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMbl = useContext(MobileViewContext);
  const shouldWarmInitialTasks = shouldWarmInitialBoardTasks({
    isMobile: isMbl,
    progressiveRendering,
    sectionNearViewport: mobileSectionNearViewport,
  });
  const handleSectionClick = useCallback(() => {
    setActiveSection(index);
    setActiveSectionId(section.sectionId ?? null);
  }, [index, section.sectionId, setActiveSection, setActiveSectionId]);

  useEffect(() => {
    if (active) setActiveSectionId(section.sectionId ?? null);
  }, [active, section.sectionId, setActiveSectionId]);

  const { sectionRef, createTaskAt, tasksPlayList } = useSections({
    active,
    items: section.items ?? [],
    index,
    title: section.section_title,
    sectionId: section.sectionId!,
    projectId: currentProject?.id!,
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const preloadTask = (attempt: number) => {
      void loadTask()
        .then(() => {
          if (cancelled) return;
          setTaskModuleFailed(false);
          setTaskModuleReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt === 0) {
            retryTimer = setTimeout(() => preloadTask(1), 1_500);
            return;
          }
          // Keep the board navigable after a stale or unavailable chunk. The
          // lightweight task links remain usable and a reload can retry later.
          setTaskModuleFailed(true);
        });
    };
    preloadTask(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!isMbl || !progressiveRendering || mobileSectionNearViewport) return;
    const sectionElement = sectionRef.current as HTMLElement | null;
    if (!sectionElement || typeof IntersectionObserver === "undefined") {
      setMobileSectionNearViewport(true);
      return;
    }

    const horizontalScroller = sectionElement.closest<HTMLElement>(
      ".homepage-container-tag",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setMobileSectionNearViewport(true);
        observer.disconnect();
      },
      // Prepare the next horizontal column shortly before it enters the phone
      // viewport without mounting every column during startup. The nested
      // scroller must be the root so its clipping does not cancel the margin.
      getMobileSectionObserverOptions(horizontalScroller),
    );
    observer.observe(sectionElement);
    return () => observer.disconnect();
  }, [
    isMbl,
    mobileSectionNearViewport,
    progressiveRendering,
    sectionRef,
  ]);

  const revealTask = useCallback((taskId: number, restoreFocus = false) => {
    if (!taskModuleReady) return;
    if (restoreFocus) pendingFocusTaskId.current = taskId;
    setRevealedTaskIds((current) => {
      if (current.has(taskId)) return current;
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
  }, [taskModuleReady]);

  const openTask = useCallback(
    (task: ITask) => {
      if (task.uniqueIndex === undefined) return;
      setTasksPlayList(tasksPlayList);
      navigateToTask(task.projectId, task.uniqueIndex);
    },
    [navigateToTask, setTasksPlayList, tasksPlayList],
  );

  useEffect(() => {
    if (
      !progressiveRendering ||
      !taskModuleReady ||
      renderAllTasks ||
      !shouldWarmInitialTasks
    ) return;
    const root = sectionRef.current as HTMLElement | null;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const taskId = Number.parseInt(
            (entry.target as HTMLElement).dataset.progressiveTaskId ?? "",
            10,
          );
          if (!Number.isFinite(taskId)) continue;
          if (entry.isIntersecting) intersectingTaskIds.current.add(taskId);
          else intersectingTaskIds.current.delete(taskId);
        }

        if (revealTimer.current) clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => {
          revealTimer.current = null;
          const nearbyTaskIds = [...intersectingTaskIds.current];
          if (nearbyTaskIds.length === 0) return;
          setRevealedTaskIds((current) => {
            if (nearbyTaskIds.every((taskId) => current.has(taskId))) {
              return current;
            }
            return new Set([...current, ...nearbyTaskIds]);
          });
        }, PROGRESSIVE_REVEAL_SETTLE_MS);
      },
      {
        // Keep a small buffer ready, but do not mount every card crossed during
        // a fast flick. The timer above upgrades cards once scrolling settles.
        rootMargin: "240px 160px",
      },
    );

    root
      .querySelectorAll<HTMLElement>("[data-progressive-task-id]")
      .forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      intersectingTaskIds.current.clear();
      if (revealTimer.current) {
        clearTimeout(revealTimer.current);
        revealTimer.current = null;
      }
    };
  }, [
    progressiveRendering,
    renderAllTasks,
    section.items,
    sectionRef,
    shouldWarmInitialTasks,
    taskModuleReady,
  ]);

  useEffect(() => {
    const currentTaskIds = new Set((section.items ?? []).map((task) => task.id));
    setRevealedTaskIds((current) => {
      const retained = [...current].filter((taskId) => currentTaskIds.has(taskId));
      return retained.length === current.size ? current : new Set(retained);
    });
  }, [section.items]);

  useLayoutEffect(() => {
    const taskId = pendingFocusTaskId.current;
    if (taskId === null || !revealedTaskIds.has(taskId)) return;
    const restoreFocus = () => {
      const taskElement = document.getElementById(`task-${taskId}`);
      if (taskElement && !taskElement.dataset.progressiveTaskId) {
        pendingFocusTaskId.current = null;
        taskElement.focus();
        return true;
      }
      return false;
    };
    if (restoreFocus()) return;

    const observer = new MutationObserver(() => {
      if (restoreFocus()) observer.disconnect();
    });
    observer.observe(sectionRef.current ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [revealedTaskIds, sectionRef]);

  const archivedTasksForSection = useMemo(
    () =>
      showArchivedOnBoard
        ? getViewAppliedArchivedTasks(
            archivedTasks,
            section.sectionId,
            currentProject,
          )
        : [],
    [archivedTasks, currentProject, section.sectionId, showArchivedOnBoard]
  );
  const archivedTasksPlayList = useMemo(
    () =>
      showArchivedOnBoard
        ? [
            ...tasksPlayList,
            ...archivedTasksForSection.map((task) => ({
              id: task.id,
              projectId: task.projectId,
              uniqueIndex: task.uniqueIndex,
            })),
          ]
        : tasksPlayList,
    [archivedTasksForSection, showArchivedOnBoard, tasksPlayList]
  );
  const topSectionPayload = useMemo(
    () => ({
      sectionId: section.sectionId!,
      sectionTitle: section.section_title,
      position: "top" as const,
      priority:
        currentProject?.sorting_mode === "Priority"
          ? globalConstants.PriorityConstants[1]
          : undefined,
    }),
    [currentProject?.sorting_mode, section.sectionId, section.section_title]
  );
  const bottomSectionPayload = useMemo(
    () => ({
      sectionId: section.sectionId!,
      sectionTitle: section.section_title,
      position: "bottom" as const,
    }),
    [section.sectionId, section.section_title]
  );

  return (
    <Droppable
      droppableId={index.toString()}
      key={index.toString()}
    >
      {(provided, snapshot) => (
        <div
          ref={(element) => {
            sectionRef.current = element;
            draggableInnerRef?.(element);
          }}
          {...draggableProps}
          tabIndex={-1}
          // onKeyDown={handleKeyDown}
          onClick={handleSectionClick}
          className={`
              ${hiddenBySearch ? "hidden" : ""}
              ${
                isMbl
                  ? "min-w-[300px]  pb-4"
                  : " border-[1px] border-pageBackground group/main focus:border-[1px] focus:border-white-black mobileResponsive md:w-full flex flex-col items-start h-auto "
              }
                focus:outline-none  bg-containerBackground shadow-md rounded-md
                max-h-inherit section-container relative
                `}
        >
          {!isMbl &&
            currentProject &&
            activeSortingMode !== "Manual" &&
            snapshot.isDraggingOver && (
              <DragoverOverlay mode={activeSortingMode} />
            )}

          <div
            id={`droppable-section-container-${section.sectionId}`}
            {...provided.droppableProps}
            style={{ scrollBehavior: "unset" }}
            ref={provided.innerRef}
            data-title={section.section_title}
            className={`
              ${isMbl ? "" : "overflow-y-auto "}
              w-full sm:pb-20 h-full  max-h-inherit 
              
              scrollbar-thin 
              hover:scrollbar-thumb-gray-500 
              scrollbar-thumb-gray-500
              scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]
              `}
          >
            <div
              {...dragHandleProps}
              // Edge-tab feel: suppress the dnd library's default grab-hand cursor
              className="task-detail-heading-tag bg-containerBackground px-2 py-2 !cursor-default"
            >
              <TitleAndTasks
                itemLen={section.items?.length ?? 0}
                title={section.section_title}
                id={section.sectionId!}
              />
              <NewTaskButton
                buttonPosition="top"
                createTaskAt={createTaskAt}
                sectionPayload={topSectionPayload}
              />
            </div>
            {/* tasks */}
            <div
              id={`tasks-list-${index}`}
              className={`
                ${isMbl ? " scrollbar-thin  overflow-y-auto max-h-[98%]" : ""}
                "w-full px-2 space-y-4 mt-0"`}
            >
              {(section.items ?? []).map((task: ITask, i: number) => {
                const shouldRenderTask =
                  !progressiveRendering ||
                  typeof IntersectionObserver === "undefined" ||
                  renderAllTasks ||
                  (shouldWarmInitialTasks &&
                    i < INITIAL_PROGRESSIVE_TASKS_PER_SECTION) ||
                  task.id === activeItem ||
                  revealedTaskIds.has(task.id);
                const renderMode = getProgressiveTaskRenderMode({
                  isMobile: isMbl,
                  taskModuleReady,
                  taskModuleFailed,
                  shouldRenderTask,
                });
                return (
                  <Draggable
                    shouldRespectForcePress={false}
                    key={`task-${task.id}`}
                    draggableId={`task-${task.id}`}
                    index={i}
                    isDragDisabled={!taskModuleReady || dragDisabled}
                  >
                    {(provided, snapshot) =>
                      renderMode === "skeleton" ? (
                        <TaskSkeleton provided={provided} />
                      ) : renderMode === "placeholder" ? (
                        <ProgressiveTaskPlaceholder
                          task={task}
                          provided={provided}
                          onReveal={revealTask}
                          onOpen={openTask}
                          keyboardAccessible={taskModuleFailed}
                        />
                      ) : (
                        <Task
                          task={task}
                          archiveNotification={archiveNotification}
                          tasksPlayList={tasksPlayList}
                          moveItemUp={moveItemUp}
                          moveItemDown={moveItemDown}
                          moveItemLeft={moveItemLeft}
                          moveItemRight={moveItemRight}
                          sectionIndex={index}
                          markAsDone={markAsDone}
                          updateAssignees={updateAssignees}
                          sectionId={section.sectionId!}
                          index={i}
                          project={currentProject!}
                          currentSetting={currentSetting}
                          dragProvided={provided}
                          dragSnapshot={snapshot}
                          blockingUser={
                            task.waitingOnUser ??
                            (task.waitingOnUserId != null
                              ? membersById.get(task.waitingOnUserId)
                              : undefined)
                          }
                        />
                      )
                    }
                  </Draggable>
                );
              })}
              {archivedTasksForSection.map((task: ITask, i: number) => {
                return (
                  <Task
                    task={task}
                    archiveNotification={archiveNotification}
                    tasksPlayList={archivedTasksPlayList}
                    moveItemUp={moveItemUp}
                    moveItemDown={moveItemDown}
                    moveItemLeft={moveItemLeft}
                    moveItemRight={moveItemRight}
                    sectionIndex={index}
                    markAsDone={markAsDone}
                    updateAssignees={updateAssignees}
                    sectionId={section.sectionId!}
                    key={`archived-task-${task.id}`}
                    index={(section.items?.length ?? 0) + i}
                    project={currentProject!}
                    currentSetting={currentSetting}
                    isArchivedOnBoard
                    blockingUser={
                      task.waitingOnUser ??
                      (task.waitingOnUserId != null
                        ? membersById.get(task.waitingOnUserId)
                        : undefined)
                    }
                  />
                );
              })}
              <div className="h-[32px]">
                <NewTaskButton
                  createTaskAt={createTaskAt}
                  buttonPosition="bottom"
                  snapshot={snapshot}
                  sectionPayload={bottomSectionPayload}
                />
              </div>
            </div>

            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
};

const TitleAndTasks = ({
  itemLen,
  title,
  id,
}: {
  itemLen: number;
  title: string;
  id: number;
}) => {
  const setShowCommands = useSetRecoilState(showCommandsAtom);

  const toggleOnManageColumnsModal = () => {
    setShowCommands({ show: true, mode: CommandMode.ManageColumn })
  };
  return (
    <>
      <div className="flex items-center gap-[6px]">
        <p
          onClick={toggleOnManageColumnsModal}
          className="kanban-column-title text-left cursor-pointer text-dense text-white-black"
        >
          {title}
        </p>
        <p className="kanban-column-count text-meta font-medium self-center text-text-light-gray mt-[2px]">
          {itemLen > 0 ? itemLen : null}
        </p>
      </div>
    </>
  );
};

const DragoverOverlay = ({ mode }: { mode: TBoardSortingViewMode }) => {
  const darkBg = "rgba(33, 36, 41, .6)";
  const lightBg = "rgba(33, 36, 41, .04)";
  const { effectiveTheme } = useDarkMode();
  const styles = {
    background: effectiveTheme
      ? effectiveTheme !== "dark"
        ? lightBg
        : darkBg
      : darkBg,
  };
  return (
    <div
      style={{ ...styles }}
      className="   grid justify-center pt-[35vh]  absolute h-[100%] rounded w-full z-10"
    >
      <span className="py-2 px-3 space-y-2 h-fit sticky top-[35vh]  border-[1px] rounded font-normal text-content text-white-black bg-containerBackground">
        <p>Drop here to move to this column.</p>
        <p>
          This board is sorted by {sortingModeLabel(mode)}
        </p>
      </span>
    </div>
  );
};
export default React.memo(Section);
