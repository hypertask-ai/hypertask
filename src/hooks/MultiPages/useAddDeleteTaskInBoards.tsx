
import { currentProjectAtom, activeSectionAtom, currentUserAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { useStore } from "jotai";
import generateRanking from '@/utils/generateRank'

import axios from 'axios';
import UpdateKanban from './useUpdateTaskInBoards';
import { returnSortedItems } from "@/utils/helperFunctions/helperFunctions";
import { ITask } from "@/models/model";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG } from "@/lib/flags/keys";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getNewTaskViewDefaults } from "@/utils/helperFunctions/Views/NewTaskViewDefaults";
import { PriorityConstants } from "@/lib/constants/constants";
import createNewTaskGloballyAPIHandler from "@/utils/api/global/apiHelpers/createTaskGloballycontroller";


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

const useAddDeleteTaskInBoards = () => {
  const queryClient = useQueryClient();
  const store = useStore();
  const _currentProject = useRecoilValue(currentProjectAtom)
  const currentUser = useRecoilValue(currentUserAtom);
  const quickAddViewContextEnabled = useFlag(HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG);
  const getActiveSection = () => store.get(activeSectionAtom);

  const { updateActiveItemAndItemInView, mutationHandler, getProjectIdxAndAllData } = UpdateKanban()

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
  
    if (sectionIndex === -1) return;
  
    const section = sections[sectionIndex];
  
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
  
    const updatedSections = sections.map((sec, idx) =>
      idx === sectionIndex
        ? {
            ...sec,
            items: sortedItems,
          }
        : sec
    );
  
    const updatedTasksArray: ITask[] = [...(projectToUpdate.tasks || []), taskForCache];

    if (taskForCache.priority) queryClient.setQueryData(["priority", taskForCache.id], taskForCache.priority);
    if (taskForCache.estimate) queryClient.setQueryData(["estimate", taskForCache.id], taskForCache.estimate);
    queryClient.setQueryData(["taskLabels", taskForCache.id], taskForCache.taskLabels);
  
    mutationHandler(projectToUpdateIndex, updatedSections, allData, updatedTasksArray);
    updateActiveItemAndItemInView(task.id, _currentProject.id, getActiveSection());
  };
  

  const createItem = async (props: CreateItemParams): Promise<boolean> => {
    console.log("🚀 ~ createItem ~ props:", props)
    const { sectionId, section, item, position, createAnother, projectId } = props
    console.log("🚀 ~ createItem ~ _currentProject:", _currentProject)

    if (!_currentProject || _currentProject.id !== projectId) return false;
    try {
    const { allData, projectToUpdateIndex } = await getProjectIdxAndAllData(_currentProject?.id)
      console.log("🚀 ~ createItem ~ projectToUpdateIndex:", projectToUpdateIndex)
      console.log("🚀 ~ createItem ~ allData:", allData)

    if (!allData || !allData.updatedProjects || projectToUpdateIndex === undefined || projectToUpdateIndex === -1) return false;

    const sections = allData?.updatedProjects[projectToUpdateIndex]?.sections
    console.log("🚀 ~ createItem ~ sections:", sections)


    const sectionIndex = _currentProject.sections.findIndex((sec) => sec.sectionId === sectionId);
    console.log("🚀 ~ createItem ~ sectionIndex:", sectionIndex)

    const ranking = generateRanking(
      position === "top" ? undefined : sections[sectionIndex]?.items[sections[sectionIndex]?.items.length - 1]?.ranking,
      position === "top" ? sections[sectionIndex]?.items[0]?.ranking : undefined
    );

    console.log("🚀 ~ createItem ~ ranking:", ranking)
      const defaults = quickAddViewContextEnabled
        ? getNewTaskViewDefaults(getActiveFiltersFromProject(_currentProject))
        : undefined;
      const useViewContext = Boolean(defaults && (
        defaults.tags?.length || defaults.assignees.length || defaults.priority || defaults.estimate
      ));
      let task: ITask;
      if (useViewContext && defaults) {
        if (!currentUser?.id) return false;
        const result = await createNewTaskGloballyAPIHandler({
          ...item,
          ...defaults,
          priority: defaults.priority ?? (
            _currentProject.sorting_mode === "Priority" && position === "top" && sections[sectionIndex]?.items.length
              ? PriorityConstants.find((priority) => priority.priority_index === 1)
              : undefined
          ),
          userId: currentUser.id,
          projectId,
          projectIdentifier: _currentProject.uniqueIdentifier ?? "TASK",
          sectionId,
          section_title: section,
          ranking,
        });
        if (result?.error || !result?.resposne?.newTask) return false;
        task = {
          ...result.resposne.newTask,
          assignees: defaults.assignees.map((assignee) => "uid" in assignee
            ? { userId: assignee.id, user: assignee }
            : { userId: assignee.userId, agentId: assignee.id, agent: assignee }
          ) as ITask["assignees"],
        };
        queryClient.setQueryData(["taskLabels", task.id], task.taskLabels ?? []);
        if (task.priority) queryClient.setQueryData(["priority", task.id], task.priority);
        if (task.estimate) queryClient.setQueryData(["estimate", task.id], task.estimate);
      } else {
        const res = await axios.post("/api/tasks/create", {
          ...item,
          sectionId,
          section,
          assignees: [],
          userId: currentUser?.id,
          projectId,
          ranking,
          index: _currentProject?.sorting_mode === "Priority" && position === "top" ? 0 : sections[sectionIndex]?.items.length,
        });

        if (res.status !== 200) return false;

        task = res.data;
      }
      try {
      const targetSection = sections[sectionIndex];

      const updatedItems = position === "top" ? [task, ...(targetSection?.items || [])] : [...(targetSection?.items || []), task];

      const updatedSections = sections.map((sec, index) =>
        index === sectionIndex ? { ...targetSection, items: updatedItems } : sec
      );
      console.log("🚀 ~ createItem ~ updatedSections:", updatedSections);

      mutationHandler(projectToUpdateIndex, updatedSections, allData);

      if (!createAnother) updateActiveItemAndItemInView(task.id, _currentProject.id, getActiveSection());
      else updateActiveItemAndItemInView(null, _currentProject.id, getActiveSection());
      } catch (error) {
        console.log("🚀 ~ createItem ~ local update error:", error);
        void queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
      }
      return true;
    } catch (error) {
      console.log("🚀 ~ createItem ~ error:", error);
      return false;
    }
  };

  return { createItem, createTaskGlobally }
}

export default useAddDeleteTaskInBoards
