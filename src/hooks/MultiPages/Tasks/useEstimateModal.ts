import { useGetEstimateForTask } from "@/hooks/MultiPages/useGetEstimateForTask";
import globalConstants from "@/lib/constants";
import { IEstimateConstants } from "@/lib/constants/constants";
import { inViewObjectAtom, currentProjectAtom, calendarTaskFiltersAtom } from "@/store";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilValue } from "@/lib/state";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

export const useEstimateModal = (
  mode: "Task" | "Filter" | "TaskModalGlobally" | "Filter-Calendar",
  closeHandler: (param?: boolean | IEstimateConstants) => void,
  previousSize?: IEstimateConstants
) => {
  const queryClient = useQueryClient();
  const currentProject = useRecoilValue(currentProjectAtom);
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom)
  const { data: estimateForTaskTQ } = useGetEstimateForTask(
    ["estimate", inViewObject.taskId],
    inViewObject.taskId
  );

  let result;

  if (mode === "Task") {
    const taskModeOnClick = async (estimate: IEstimateConstants) => {
      if (!inViewObject.taskId) return;
      try {
        const body = {
          taskId: inViewObject.taskId,
          estimate_index: estimate.estimate_index,
          estimate_value: estimate.estimate_value,
        };
        await axios.post("/api/estimate/setEstimate", body);
        queryClient.refetchQueries({
          queryKey: [globalConstants.CommentsTQPrefixKey, inViewObject.taskId],
        });

        closeHandler(true);
      } catch (error) {
        console.log("🚀 ~ setEstimate ~ error:", error);
      }
    };

    result = {
      EnterOnClickHandler: taskModeOnClick,
      // No-size is estimate_index 0; empty (null/undefined) means No-size too.
      // Don't filter(Boolean) here — it drops 0 and the "No size" row loses its check (PERT-19).
      checkedEstimates: [estimateForTaskTQ?.estimate_index ?? 0],
    };
  } else if (mode == "Filter") {
    const activeFilters =
      getActiveFiltersFromProject(currentProject).addedFilters;
    const currentlyActive = activeFilters.find(
      (filter) => filter.type === "Size"
    );

    result = {
      EnterOnClickHandler: (estimate: IEstimateConstants) =>
        closeHandler(estimate),
      checkedEstimates:
        currentlyActive?.searchPayload.map((x) => x.estimate_index) ?? [],
    };
  } else if (mode === "Filter-Calendar") {
    result = {
      EnterOnClickHandler: (estimate: IEstimateConstants) =>
        closeHandler(estimate),
      checkedEstimates: calendarTaskFilters?.size,
    };
  } else {
    result = {
      EnterOnClickHandler: (estimate: IEstimateConstants) =>
        closeHandler(estimate),
      checkedEstimates: previousSize ? [previousSize.estimate_index] : [],
    };
  }

  return result;
};
