import { logger as htLogger } from "#logger";

import { currentProjectAtom, activeSectionAtom, currentUserAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { useStore } from "jotai";
import generateRanking from '@/utils/generateRank'

import UpdateKanban from './useUpdateTaskInBoards';
import createNewTaskGloballyAPIHandler from "@/utils/api/global/apiHelpers/createTaskGloballycontroller";
import { returnSortedItems } from "@/utils/helperFunctions/helperFunctions";
import { ITask } from "@/models/model";
import globalConstants from "@/lib/constants";


interface CreateItemParams {
  sectionId: number;
  section: string;
  item: any;
  position: "top" | "bottom";
  createAnother: boolean;
  projectId: number
}

interface CreateTaskGloballyParams {
  sectionId: number;
  task: ITask;
  position: "top" | "bottom"
}

// this is a sample of how our code can be reused and resturcured. 
// this speficic file is responsible for adding/deleting tasks, could very well be in updateKanban hook. 
// but the code there now I look at, consists mostly of Main code necessary to UPDATE kanban.
// thus we reuse those parts such as Mutation handler and others, and create our independent functions as we wish. 
// so moving with the plan =>  hooks for
// ADDING/DELETING
// Updating a task instance. 

// and lastly create a singular hook that is also indepndent but has 3 main functions we have also used below. 



const useAddDeleteTaskInBoards = () => {
  const queryClient = useQueryClient();
  const store = useStore();
  const _currentProject = useRecoilValue(currentProjectAtom)
  const currentUser = useRecoilValue(currentUserAtom);
  const getActiveSection = () => store.get(activeSectionAtom);

  const { updateActiveItemAndItemInView, mutationHandler, getProjectIdxAndAllData } = UpdateKanban()
  // item operatioins

  const addSubtaskToParent = (parentTask: ITask, subtask: ITask) => {

  }

  const createTaskGlobally = async (props: CreateTaskGloballyParams) => {
    const { sectionId, task, position } = props;
    const taskForCache = { ...task, taskLabels: task.taskLabels ?? [] };
  
    if (!_currentProject) return;
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject.id);
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return;
  
    const projectToUpdate = { ...allData.updatedProjects[projectToUpdateIndex] };
    const sections = projectToUpdate.sections || [];
    const sectionIndex = sections.findIndex((sec) => sec.sectionId === sectionId);
  
    if (sectionIndex === -1) return; // Exit if the section doesn't exist.
  
    const section = sections[sectionIndex];
  
    // Update section items
    const updatedItems = section.items.map((secTask) => {
      if (secTask.id === task.parentTaskId) {
        return {
          ...secTask,
          subTasks: [...(secTask.subTasks || []), taskForCache],
        };
      }
      return secTask;
    });
  
    const newItems = [taskForCache, ...updatedItems];
    const sortedItems = returnSortedItems(newItems, _currentProject);
  
    // Create updated sections
    const updatedSections = sections.map((sec, idx) =>
      idx === sectionIndex
        ? {
            ...sec,
            items: sortedItems,
          }
        : sec
    );
  
    // Update tasks array
    const updatedTasksArray: ITask[] = [...(projectToUpdate.tasks || []), taskForCache];

    if (taskForCache.priority) queryClient.setQueryData(["priority", taskForCache.id], taskForCache.priority);
    if (taskForCache.estimate) queryClient.setQueryData(["estimate", taskForCache.id], taskForCache.estimate);
    queryClient.setQueryData(["taskLabels", taskForCache.id], taskForCache.taskLabels);
  
    // Apply mutations and update active item
    mutationHandler(projectToUpdateIndex, updatedSections, allData, updatedTasksArray);
    updateActiveItemAndItemInView(task.id, _currentProject.id, getActiveSection());
  };
  

  const createItem = async (props: CreateItemParams): Promise<boolean> => {
    htLogger.info("🚀 ~ createItem ~ props:", props)
    const { sectionId, section, item, position, createAnother, projectId } = props
    htLogger.info("🚀 ~ createItem ~ _currentProject:", _currentProject)

    if (!_currentProject || _currentProject.id !== projectId || !currentUser?.id) return false;
    try {
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)
      htLogger.info("🚀 ~ createItem ~ projectToUpdateIndex:", projectToUpdateIndex)
      htLogger.info("🚀 ~ createItem ~ allData:", allData)

    // if (!allData || !projectToUpdateIndex) return;
    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return false;

    const sections = allData?.updatedProjects[projectToUpdateIndex]?.sections
    htLogger.info("🚀 ~ createItem ~ sections:", sections)


    const sectionIndex = _currentProject.sections.findIndex((sec) => sec.sectionId === sectionId);
    htLogger.info("🚀 ~ createItem ~ sectionIndex:", sectionIndex)

    const ranking = generateRanking(
      position === "top" ? undefined : sections[sectionIndex]?.items[sections[sectionIndex]?.items.length - 1]?.ranking,
      position === "top" ? sections[sectionIndex]?.items[0]?.ranking : undefined
    );

    htLogger.info("🚀 ~ createItem ~ ranking:", ranking)
      const result = await createNewTaskGloballyAPIHandler({
        userId: currentUser.id,
        projectId,
        projectIdentifier: _currentProject.uniqueIdentifier ?? "TASK",
        title: item.title,
        ranking,
        sectionId,
        section_title: section,
        priority:
          _currentProject.sorting_mode === "Priority" && position === "top"
            ? globalConstants.PriorityConstants[1]
            : undefined,
        tags: item.tags,
        assignees: [],
      });
      const task = result?.resposne?.newTask;
      if (!task || result?.error) return false;
      try {
      const targetSection = sections[sectionIndex];

      const updatedItems = position === "top" ? [task, ...(targetSection?.items || [])] : [...(targetSection?.items || []), task];

      const updatedSections = sections.map((sec, index) =>
        index === sectionIndex ? { ...targetSection, items: updatedItems } : sec
      );
      htLogger.info("🚀 ~ createItem ~ updatedSections:", updatedSections);

      mutationHandler(projectToUpdateIndex, updatedSections, allData);

      if (!createAnother) updateActiveItemAndItemInView(task.id, _currentProject.id, getActiveSection());
      else updateActiveItemAndItemInView(null, _currentProject.id, getActiveSection());
      } catch (error) {
        htLogger.info("🚀 ~ createItem ~ local update error:", error);
        void queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
      }
      return true;
    } catch (error) {
      htLogger.info("🚀 ~ createItem ~ error:", error);
      return false;
    }
  };

  return { createItem, createTaskGlobally }
}

export default useAddDeleteTaskInBoards
