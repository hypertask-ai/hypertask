import { useGetPriorityForTask } from "@/hooks/MultiPages/useGetPriorityForTask";
import globalConstants from "@/lib/constants";
import { IPrioritiesConstants } from "@/lib/constants/constants";
import { inViewObjectAtom, currentProjectAtom, calendarTaskFiltersAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilValue } from "@/lib/state";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

export const usePriorityModal = (
  mode: "Task" | "Filter" | "TaskModalGlobally" | "Filter-Calendar",
  closeHandler: (param?: boolean | IPrioritiesConstants) => void,
) => {
  const queryClient = useQueryClient();
  const currentProject = useRecoilValue(currentProjectAtom);
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom)
  const { data: priorityForTaskTQ } = useGetPriorityForTask(
    ["priority", inViewObject.taskId],
    inViewObject.taskId
  );

  let result;

  if (mode === "Task") {
    const taskModeOnClick = async (priority: IPrioritiesConstants) => {
      if (!inViewObject.taskId) return;
      try {
        const body = {
          taskId: inViewObject.taskId,
          priority_index: priority.priority_index,
          Priority_Value: priority.Priority_Value,
        };
        await axios.post("/api/priority/setPriority", body);
        // Board cards read priority from ["projectsAll"]; refetch it so the new
        // priority shows immediately on navigate-back instead of waiting for the
        // next incidental refetch (30s staleTime / window-focus). HTPR-4139.
        queryClient.refetchQueries({ queryKey: ["projectsAll"] });
        queryClient.refetchQueries({
          queryKey: [globalConstants.CommentsTQPrefixKey, inViewObject.taskId],
        });
        closeHandler(true);
      } catch (error) {
        console.log("🚀 ~ setPriorirty ~ error:", error);
      }
    };

    result = {
      EnterOnClickHandler: taskModeOnClick,
      checkedPriorities: [priorityForTaskTQ?.priority_index].filter(
        Boolean
      ) as number[],
    };
  } else if (mode === "Filter") {
    const activeFilters =
      getActiveFiltersFromProject(currentProject).addedFilters;
    const currentlyActive = activeFilters.find(
      (filter) => filter.type === "Priority"
    );

    result = {
      EnterOnClickHandler: (priority: IPrioritiesConstants) =>
        closeHandler(priority),
      checkedPriorities:
        currentlyActive?.searchPayload.map((x) => x.priority_index) ?? [],
    };
  } else if (mode === "Filter-Calendar") {
    result = {
      EnterOnClickHandler: (priority: IPrioritiesConstants) =>
        closeHandler(priority),
      checkedPriorities: calendarTaskFilters.priority,
    };
  } else {
    result = {
      EnterOnClickHandler: (priority: IPrioritiesConstants) =>
        closeHandler(priority),
      checkedPriorities: [],
    };
  }

  return result;
};
