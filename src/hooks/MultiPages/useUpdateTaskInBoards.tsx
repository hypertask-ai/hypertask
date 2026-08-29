
import { useRef } from "react";
import { IAiCustomInstructions, IProject, IProjectsAll, IProjectView, ISection, ITask } from "@/models/model";
import { activeBuiltinViewsAtom, activeItemAtom, inViewObjectAtom, currentProjectAtom, currentUserAtom, } from "@/store";
import globalAPIHandlers from "@/utils/api/global";
import { getCurrentProject, returnSortedItems, } from "@/utils/helperFunctions/helperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import generateRanking from '@/utils/generateRank'
import globalConstants from "@/lib/constants";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { getFilteredSections } from "../../utils/helperFunctions/Views/FilterHelperFunctions";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getActiveSubtaskSettingFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import { useUndoContext } from "../General/useUndo";
import useGlobalFocusHandler from "../Inbox/useGlobalFocusHandler";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { getAppliedSearchedTasks } from "@/utils/helperFunctions/Views/SearchFilterHelperFunction";
import { nextFocusAfterRemoval } from "@/utils/helperFunctions/focusAfterRemoval";
import { appendCreatedSectionToProject } from "@/utils/helperFunctions/Views/appendCreatedSection";
import { buildBuiltinViewContext, BuiltinViewId, isBuiltinViewId } from "@/lib/constants/builtinViews";
import type { IFilterRuntimeContext } from "@/models/Filters/model";

type UpdateOptions = {
  updatedProjectView?: IProjectView | null;
  createdSection?: ISection;
  sections?: ISection[];
  tasks?: ITask[];
  ai_custom_instructions?: IAiCustomInstructions;
  searchKeyword?: string;
}

type RemoveFromListOptions = {
  undoRedirectPath?: string;
}

const getSectionCacheKey = (section: ISection) => section.sectionId ?? section.id;

const shallowEqualTask = (previousTask: ITask, nextTask: ITask) => {
  if (previousTask === nextTask) return true;

  const previousKeys = Object.keys(previousTask) as Array<keyof ITask>;
  const nextKeys = Object.keys(nextTask) as Array<keyof ITask>;
  if (previousKeys.length !== nextKeys.length) return false;

  return previousKeys.every((key) => Object.is(previousTask[key], nextTask[key]));
};

const shallowEqualSectionExceptItems = (
  previousSection: ISection,
  nextSection: ISection
) => {
  if (previousSection === nextSection) return true;

  const keys = new Set([
    ...Object.keys(previousSection),
    ...Object.keys(nextSection),
  ] as Array<keyof ISection>);

  for (const key of keys) {
    if (key === "items") continue;
    if (!Object.is(previousSection[key], nextSection[key])) return false;
  }

  return true;
};

const reconcileTasks = (
  previousTasks?: ITask[] | null,
  nextTasks?: ITask[] | null
) => {
  const previousTaskList = previousTasks ?? [];
  const nextTaskList = nextTasks ?? [];
  const previousById = new Map<number, ITask>();
  previousTaskList.forEach((task) => {
    if (task) previousById.set(task.id, task);
  });

  let changed = previousTaskList.length !== nextTaskList.length;
  const reconciledTasks = nextTaskList.map((nextTask, index) => {
    const previousTask = previousById.get(nextTask.id);
    if (previousTask && shallowEqualTask(previousTask, nextTask)) {
      if (previousTaskList[index] !== previousTask) changed = true;
      return previousTask;
    }

    if (previousTaskList[index] !== nextTask) changed = true;
    return nextTask;
  });

  return changed ? reconciledTasks : previousTaskList;
};

const reconcileSections = (
  previousSections?: ISection[] | null,
  nextSections?: ISection[] | null
) => {
  const previousSectionList = previousSections ?? [];
  const nextSectionList = nextSections ?? [];
  const previousByKey = new Map<number, ISection>();
  previousSectionList.forEach((section) => {
    const key = getSectionCacheKey(section);
    if (key !== undefined) previousByKey.set(key, section);
  });

  let changed = previousSectionList.length !== nextSectionList.length;
  const reconciledSections = nextSectionList.map((nextSection, index) => {
    const sectionKey = getSectionCacheKey(nextSection);
    const previousSection =
      sectionKey !== undefined ? previousByKey.get(sectionKey) : undefined;

    if (!previousSection) {
      if (previousSectionList[index] !== nextSection) changed = true;
      return nextSection;
    }

    const items = reconcileTasks(previousSection.items, nextSection.items);
    const shouldReuseSection =
      items === previousSection.items &&
      shallowEqualSectionExceptItems(previousSection, nextSection);

    if (shouldReuseSection) {
      if (previousSectionList[index] !== previousSection) changed = true;
      return previousSection;
    }

    changed = true;
    return { ...nextSection, items };
  });

  return changed ? reconciledSections : previousSectionList;
};

const replaceProjectAtIndex = (
  projects: IProject[],
  projectIndex: number,
  project: IProject
) => {
  if (projects[projectIndex] === project) return projects;

  const updatedProjects = projects.slice();
  updatedProjects[projectIndex] = project;
  return updatedProjects;
};

const applyProjectFilters = (
  project: IProject,
  searchKeyword?: string,
  builtinViewId?: BuiltinViewId,
  currentUserId?: number,
  runtimeContext?: IFilterRuntimeContext,
) => {
  let filteredSections = getAppliedSubtaskSections(project.sections, project);
  filteredSections = getFilteredSections(
    filteredSections,
    project,
    builtinViewId,
    buildBuiltinViewContext(project, currentUserId),
    runtimeContext,
  );

  if (searchKeyword && searchKeyword.length > 0) {
    filteredSections = getAppliedSearchedTasks(filteredSections, searchKeyword);
  }

  return getFilteredEmptySections(filteredSections, project);
};




// =========== TODO 1: export updateActiveItemAndItemInView, removeFromListWithStatus, mutationHandler as INDEPDENTANT hook, 
// =========== TODO 2: use this hook to perform task update and task movemnt operations only. 

const UpdateKanban = () => {
  const queryClient = useQueryClient();
  const setactiveitem = useSetRecoilState(activeItemAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const [_currentProject, __] = useRecoilState(currentProjectAtom)
  const [_currentUser, ___] = useRecoilState(currentUserAtom);
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
  // updateProject runs from closures captured in earlier renders (e.g. the view
  // switch awaits a POST first), so read the active built-in at call time. A
  // stale copy re-applies a built-in filter the user has already left.
  const activeBuiltinViewsRef = useRef(activeBuiltinViews);
  activeBuiltinViewsRef.current = activeBuiltinViews;
  const router = useRouter();
  const { performActionAndStoreUndoData, undoAction } = useUndoContext();
  const { archiveNotificationGetter } = useGlobalFocusHandler()



  const updateProject = (
    projectIndex: number,
    allData: IProjectsAll | undefined,
    { updatedProjectView, createdSection, sections, tasks, ai_custom_instructions, searchKeyword }: UpdateOptions
  ) => {
    if (
      !allData ||
      !allData.updatedProjects ||
      projectIndex === undefined ||
      projectIndex === -1
    )
      return;

    const previousProject = allData.updatedProjects[projectIndex];
    if (!previousProject) return;
    let projectToUpdate: IProject = previousProject;

    // Apply the updates conditionally
    // HTPR-5542: a board with no saved view has no Project_View row, so creating
    // a column answers with project_view: null. Recompute off the new section in
    // that case too, or the column only appears after a reload.
    projectToUpdate = appendCreatedSectionToProject(projectToUpdate, createdSection);

    if (updatedProjectView || createdSection) {
      if (updatedProjectView) {
        projectToUpdate = { ...projectToUpdate, project_view: updatedProjectView };
      }
      const { _sections, firstTask } = getCurrentProject(projectToUpdate) as {
        _sections: ISection[];
        firstTask: ITask | null;
      };

      projectToUpdate = {
        ...projectToUpdate,
        sections: reconcileSections(previousProject.sections, _sections),
        firstTask,
      };
    }

    if (sections) {
      projectToUpdate = {
        ...projectToUpdate,
        sections: reconcileSections(previousProject.sections, sections),
      };
    }
    if (tasks) {
      projectToUpdate = {
        ...projectToUpdate,
        tasks: reconcileTasks(previousProject.tasks, tasks),
      };
    }
    console.log("🚀 ~ UpdateKanban ~ ai_custom_instructions:", ai_custom_instructions)

    if (ai_custom_instructions) {
      projectToUpdate = {
        ...projectToUpdate,
        ai_custom_instructions: [ai_custom_instructions],
      };
    }

    // Update filtered sections after all updates
    const activeBuiltinView = activeBuiltinViewsRef.current[projectToUpdate.id];
    const runningTimers = queryClient.getQueryData<Array<{ taskId: number }>>([
      "time",
      "running-board",
      projectToUpdate.id,
    ]);
    const filterRuntimeContext = Array.isArray(runningTimers)
      ? { runningTaskIds: new Set(runningTimers.map((timer) => timer.taskId)) }
      : undefined;
    const filteredSections = reconcileSections(
      previousProject.filteredSections,
      applyProjectFilters(
        projectToUpdate,
        searchKeyword,
        isBuiltinViewId(activeBuiltinView) ? activeBuiltinView : undefined,
        _currentUser?.id,
        filterRuntimeContext,
      )
    );
    projectToUpdate = {
      ...projectToUpdate,
      filteredSections,
    };
    const currentSubtaskSetting = getActiveSubtaskSettingFromProject(projectToUpdate);
    const allProjects = replaceProjectAtIndex(
      allData.updatedProjects,
      projectIndex,
      projectToUpdate
    );
    
    // Save the updated data
    setProjectData(allProjects, allData.notificationsCount, currentSubtaskSetting);
  };


  const updateProjectView = (
    projectIndex: number,
    updatedProjectView: IProjectView | null | undefined,
    createdSection?: ISection
  ) => {
    const { allData } = getProjectIdxAndAllData(
      _currentProject?.id
    );
    if (!allData || projectIndex === undefined || projectIndex === -1) return;
    updateProject(projectIndex, allData, { updatedProjectView, createdSection });
  };

  // HTPR-4142: a move removes the task from its source section and inserts it into the
  // target as two independent steps. When the cache's idea of the source is stale (an
  // agent or another client moved the task via the API), the removal misses while the
  // insert still runs, leaving the SAME task in a column twice. Every move/add/update
  // path commits through mutationHandler, so guard once here rather than in each hook.
  // Items with no id (optimistic/temp cards) are never collapsed together.
  const keepFirstById = <T extends { id?: number | string }>(item: T, index: number, list: T[]) =>
    item?.id == null || list.findIndex((other) => other?.id === item.id) === index;

  const mutationHandler = (projectIndex: number, sections: ISection[], allData: any, tasks?: ITask[]) => {
    console.time("cacheUpdate-start");
    const dedupedSections = sections?.map((section) => ({
      ...section,
      items: section.items?.filter(keepFirstById) ?? section.items,
    }));
    updateProject(projectIndex, allData, { sections: dedupedSections, tasks: tasks?.filter(keepFirstById) });
    console.timeEnd("cacheUpdate-start");
  };

  //TODO update this function so that it universally has a single source (if that makes sense somewhat)
  const updateCache = async (newSections: ISection[]) => {
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return console.log("returned from guard");
    mutationHandler(projectToUpdateIndex, newSections, allData)
  }
  // ======================== update active item and inViewObejct. We really need to update this. Or better yet we use the new one.
  const updateActiveItemAndItemInView = (taskId: number | null, projectId: number, sectionId: number | null) => {

    setactiveitem(taskId)
    setInViewObject({ taskId: taskId, taskProjectId: projectId, sectionId: sectionId })
  }

  // ======================== update cache of all projects.
  function updateTaskInCache(
    taskToReturn: any,
    taskId: number | null,
    projectId: number | null,
    sectionId: number | null | undefined,
    _currentProject?: IProject | null,
  ) {
    // const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)

    if (!taskId || !projectId || !sectionId) return;
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(projectId)

    // if (!allData || !projectToUpdateIndex) return;
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;
    const projectToUpdate = allData?.updatedProjects[projectToUpdateIndex]
    var updatedTask: ITask;

    if (projectToUpdateIndex > -1) {
      // now find the section the task is at

      const updatedSections = projectToUpdate?.sections?.map((section: ISection) => {
        if (section.sectionId === sectionId) {
          //   console.log("🚀 ~ updatedSection ~ section.sectionId:", section.sectionId)
          //   console.log("🚀 ~ updatedSection ~ section.id:", section.id)
          const updatedItems = section.items.map((task) => {
            // console.log("🚀 ~ updatedItems ~ task.uniqueIndex:", task.uniqueIndex)

            if (task.id === taskId) {
              const taskreturn = {
                ...task,
                ...taskToReturn
              };
              updatedTask = taskreturn
              return taskreturn;
            }
            return task;
          });
          let itemsToSort = returnSortedItems(updatedItems, projectToUpdate)

          // Return the updated section with the new items array
          return { ...section, items: itemsToSort };
        }
        return section;
      });

      const updatedTasks = projectToUpdate?.tasks?.map((task) => {
        // updatedTask is only set when the section pass matched. On detail
        // pages it often doesn't (task not in the cached section items), and
        // returning it unset wrote `undefined` into the cache; the NEXT
        // update then crashed on task.id here before the caller could
        // setCurrentTask, freezing the assignee panel until reload
        // (HTPR-3731). Merge inline instead, and skip already-poisoned
        // entries from caches written before this fix.
        if (task && task.id === taskId) {
          return updatedTask ?? { ...task, ...taskToReturn }
        }
        else return task
      })
      mutationHandler(projectToUpdateIndex, updatedSections, allData, updatedTasks)
    }

  }

  // ----------- given the DISPLAYED sections, the section a task is leaving, and its
  // displayed index, focus the next logical task (PERT-5). Falls back to an adjacent
  // column when the section empties, never to a random/deleted task.
  const reAdjustFocusFromCurrContext = (
    {
      sections,
      sectionIndex,
      projectId,
      sectionId,
      itemIndex // current displayed index of the leaving task
    }: {
      sections: ISection[],
      sectionIndex: number,
      projectId: number,
      itemIndex: number,
      sectionId: number
    }
  ) => {
    const nextId = nextFocusAfterRemoval(sections, sectionIndex, itemIndex);
    updateActiveItemAndItemInView(nextId, projectId, sectionId);
  }
  // -------------- purpose is to archive the element from anywhere, but also update that in kanban,
  // ============================ mainly for kanban updating. 
  async function removeFromListWithStatus(
    sectionId: number | undefined,
    projectId: number,
    taskId: number,
    status: "Archive" | "Deleted" | "Normal" | "Move",
    tasksToDelete?: number[],
    options: RemoveFromListOptions = {},
  ) {
    console.log("🚀 ~ UpdateKanban ~ tasksToDelete:", tasksToDelete)
    if (!sectionId) return;
    let itemIndex: number;
    let hasSubtasks=false;
  
    // Function to handle the update logic
    const updateSections = async () => {
      const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id);
  
      if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;
    
      const projectToUpdate = allData.updatedProjects[projectToUpdateIndex];

      const sections = projectToUpdate.sections;
      const filteredSections = projectToUpdate.filteredSections;
      const taskIdsToRemove = new Set(tasksToDelete && tasksToDelete.length ? tasksToDelete : [taskId]);
      let updatedTasksArray 
      if(tasksToDelete && tasksToDelete.length){
        updatedTasksArray=projectToUpdate.tasks?.filter((i) => !taskIdsToRemove.has(i.id));
      }
      else updatedTasksArray=projectToUpdate.tasks?.filter((i) => !taskIdsToRemove.has(i.id));
      
      let fsecIndex;
      filteredSections?.forEach((fsection:ISection, fsectionIndex:number)=>{
        if(fsection.sectionId === sectionId || fsection.id === sectionId){
          fsecIndex = fsectionIndex
          fsection.items.forEach((item, index)=>{
            if (item.id === taskId) {
              itemIndex = index;
              if (item.subTasks?.length > 0) {
                hasSubtasks = true; // Set the hasSubtasks flag
              }
            }
          })
        }
      })

      const updatedSections = sections.map((section: ISection) => {
        const updatedItems = section.items.filter((i) => !taskIdsToRemove.has(i.id));
        if (updatedItems.length === section.items.length) return section;

        const itemsToSort = returnSortedItems(updatedItems, projectToUpdate);
        return { ...section, items: itemsToSort };
      });

      const sourceSection = sections.find((section) => section.sectionId === sectionId);
      if (sourceSection) {
        const sourceTask = sourceSection.items.find((item) => item.id === taskId);
        if ((sourceTask?.subTasks?.length ?? 0) > 0) hasSubtasks = true;
      }
  
      reAdjustFocusFromCurrContext({
        sections: filteredSections,
        sectionIndex: fsecIndex ?? 0,
        sectionId,
        itemIndex,
        projectId,
      });
  
      mutationHandler(projectToUpdateIndex, updatedSections, allData, updatedTasksArray);
  
      if (status === "Deleted") toast(`Task deleted`);
    };
  
    // Function to handle the API call based on status
    const handleStatus = async () => {
      if (status === "Deleted") {
        const response = await globalAPIHandlers.deleteTaskAPI(taskId);
        if (!hasSubtasks) {
          deleteTodo("Undo task delete", { id: taskId,  status: "Deleted" });
        }
        return response;
      } else if (status !== "Move") {
        const response = await globalAPIHandlers.archiveTask(taskId, status);
        if (!hasSubtasks) {
          deleteTodo("Undo task archive", {
            id: taskId,
            status: "Archive",
            undoRedirectPath: options.undoRedirectPath,
          });
        }
        return response;
      }
    };
  
    const handleClose = async() => {
      console.log("Closing the process");
      if (hasSubtasks) {
        console.log("---------- Refetching projects all -----------");
        await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      }
    };
  
    try {
      // they cannot be stacked together in a single promise because they set values the other would use
      // Ensure updateSections runs first and sets required values
      await updateSections();
  
      // Then call handleStatus with updated values
      console.time("refetchProject")
      await handleStatus();
      console.timeEnd("refetchProject")

      // Server cascades subtask deletion; refetch (guarded by hasSubtasks) is the
      // only reconciliation for parent-with-subtasks deletes from the detail modal.
      await handleClose();

    } catch (error) {
      console.error("Error updating sections or handling status:", error);
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      throw error;
    } 
  }
  


  const setProjectData = (updatedProjects: IProject[], notificationsCount: any, subtaskSetting?: TBoardSubtaskSetting) => {
    // // Cancel any ongoing queries related to project data
    queryClient.cancelQueries({ queryKey: ["projectsAll"] });


    // // // Update the global project data in the query cache
    queryClient.setQueryData(['projectsAll'], (prev:any)=>({
      ...prev,
      updatedProjects,
      notificationsCount,
      
    }));

    if (subtaskSetting) {
      queryClient.setQueryData([
        globalConstants.GetCurrentSubtaskSettingKey,
        _currentProject?.id,
        _currentUser.id,
      ], subtaskSetting);
    }

  }
  // ============================ Async function to handle mutations in the project data
  const moveItem = async (
    body: {
      destinationSectionId: number,
      itemId: number,
      sourceSectionId: number,
    },
    options: {
      persistRanking?: boolean,
      refetchIfMissing?: boolean,
      showToast?: boolean,
      insertAtEnd?: boolean,
    } = {}
  ) => {
    const { destinationSectionId, itemId, sourceSectionId } = body
    // ============ we call this function for both arrow, drag handles, and modals, but for modal, we might not have query data but still want to shift
    // ============ if we have flag of modal, its best to not run the api call. 
    // ============ doing so if we have no query data we can just return

    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)
    if (!allData || projectToUpdateIndex === undefined || projectToUpdateIndex == -1 || destinationSectionId === sourceSectionId || !_currentProject) return

    let ranking: string | undefined = '';
    const projectToUpdate = allData.updatedProjects[projectToUpdateIndex];
    const sectionsToUpdate = projectToUpdate.sections;

    const data = sectionsToUpdate.flatMap((section, sectionIndex) =>
      section.items.map((task) => ({ task, sectionIndex }))
    ).find(({ task }) => task.id === itemId);

    if (data === undefined) {
      if (options.refetchIfMissing === false) return;
      await router.refresh()
      await queryClient.refetchQueries({ queryKey: [globalConstants.CommentsTQPrefixKey, itemId] })
      return queryClient.refetchQueries({ queryKey: ["projectsAll"] })

    }
    const { task: taskToMove, sectionIndex } = data
    console.log("🚀 ~ UpdateKanban ~ sectionIndex:", sectionIndex)
    // console.log("🚀 ~ UpdateKanban ~ taskToMove:", taskToMove)
    const destinationSecIdx = sectionsToUpdate.findIndex(
      (section) => section.sectionId === destinationSectionId
    );
    if (destinationSecIdx === -1) return;

    const destinationSection = sectionsToUpdate[destinationSecIdx];
    ranking = options.insertAtEnd
      ? generateRanking(
          destinationSection.items[destinationSection.items.length - 1]?.ranking,
          undefined
        )
      : generateRanking(
          undefined,
          destinationSection.items.length > 0 ? destinationSection.items[0].ranking : undefined
        );
    const newItem: ITask = {
      ...taskToMove,
      sectionId: destinationSectionId,
      ranking,
    };
    const destinationItems = options.insertAtEnd
      ? [...destinationSection.items, newItem]
      : destinationSection.items.length === 0
        ? [newItem]
        : [newItem, ...destinationSection.items];
    const sortedDestinationItems = returnSortedItems(
      destinationItems,
      _currentProject
    );

    const newSections = sectionsToUpdate.map((sec) => {
      if (sec.sectionId === sourceSectionId) {
        const sourceItems = sec.items.filter((task) => task.id !== itemId);
        return { ...sec, items: sourceItems };
      }

      if (sec.sectionId === destinationSectionId) {
        return { ...sec, items: sortedDestinationItems };
      }

      return sec;
    });

    if (options.persistRanking !== false) {
      fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTask: { id: itemId, ranking: ranking } })
      }).catch(() => queryClient.refetchQueries({ queryKey: ["projectsAll"] }))
    }
    if (options.showToast !== false) {
      toast(`${taskToMove.ticketNumber?.toUpperCase()} has been moved to ${sectionsToUpdate[destinationSecIdx].section_title}`)
    }
    // focus the next logical task in the SOURCE column, using displayed (filtered) order
    const filteredSrc: ISection[] = allData.updatedProjects[projectToUpdateIndex].filteredSections ?? []
    const srcFilteredIdx = filteredSrc.findIndex((s) => s.sectionId === sourceSectionId || s.id === sourceSectionId)
    const dispItemIndex = filteredSrc[srcFilteredIdx]?.items.findIndex((i) => i.id === itemId) ?? -1
    reAdjustFocusFromCurrContext({ sections: filteredSrc, sectionIndex: srcFilteredIdx, sectionId: sourceSectionId, itemIndex: dispItemIndex, projectId: _currentProject.id })
    updateCache(newSections)


  }

  const getProjectIdxAndAllData = (currentProjectId: number | undefined | null) => {
    var allData: IProjectsAll | undefined = undefined;
    var projectToUpdateIndex: number = -1;

    allData = queryClient.getQueryData(["projectsAll"]);
    projectToUpdateIndex = allData?.updatedProjects?.findIndex((project: { id: number | null; }) => project.id === currentProjectId) ?? -1


    return { projectToUpdateIndex, allData }

  }

  const renameBoard = async (title: string, projectId: number) => {
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;


    const copyAllProjects = allData.updatedProjects.map((project) => {
      if (project.id === projectId) {
        return { ...project, title }
      }
      else return project
    })
    return queryClient.setQueryData(['projectsAll'], (prev:any) => ({
      ...prev,
      updatedProjects: copyAllProjects,
      notificationsCount: allData.notificationsCount
    }));

  }

  const allDataExists = (allData: any, projectToUpdateIndex: number) => {
    if (!allData || !allData.updatedProjects || projectToUpdateIndex == -1) return false;

  }

  // ================= UNDO ARCHIVE INBOX NOTIFICATION =============== 
  const undoInboxArchive = async (dataBeforeDeletion: any) => {
    // Make the necessary API call to delete the todo using Prisma
    // Store the necessary information for undo
    archiveNotificationGetter(dataBeforeDeletion, "Notification", null)
    // performActionAndStoreUndoData(dataBeforeDeletion,"Undo archive", undoHandler);
  }

  // ============== task archive/ delete undo handler
  const undoHandler = async (data: any, toastId: string) => {
    //  first you need to bring the item back in its place.
    // then you need to run the api call so there is no render blocking. 
    await undoAction("UNDO_REMOVE", data)
    toast.dismiss(toastId);  // Dismiss the toast here
    await queryClient.refetchQueries({ queryKey: ["projectsAll"] })
    if (typeof data.undoRedirectPath === "string") {
      router.replace(data.undoRedirectPath)
    }


  }

  async function deleteTodo(displayText: string, dataBeforeDeletion: any) {
    // Make the necessary API call to delete the todo using Prisma

    // Store the necessary information for undo
    // performActionAndStoreUndoData(dataBeforeDeletion);
    performActionAndStoreUndoData(dataBeforeDeletion, displayText, undoHandler);
  }

    /**
   * Function responsible for updating sections in current project cache.
   * Since it mainly uses functions that are home to this hook, we don't need to export
   * those functions elsewhere.
   * @param {ISection[]} updatedSections
   * @param {ITask[]} updatedTasks
   * @return {*}
   */
    function updateSectionsInProject(
      updatedSections: ISection[] = [],
      updatedTasks: ITask[] = []
    ) {
      const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(
        _currentProject?.id
      );
      if (
        !allData ||
        !allData.updatedProjects ||
        projectToUpdateIndex == -1 ||
        projectToUpdateIndex === undefined
      )
        return;
      mutationHandler(
        projectToUpdateIndex,
        updatedSections,
        allData,
        updatedTasks
      );
    }

  return {
    updateTaskInCache, mutationHandler,
    allDataExists, renameBoard,
    removeFromListWithStatus, updateActiveItemAndItemInView,
    moveItem, getProjectIdxAndAllData, updateCache,
    updateProjectView,
    updateProject,
    updateSectionsInProject,
  }

}

export default UpdateKanban
