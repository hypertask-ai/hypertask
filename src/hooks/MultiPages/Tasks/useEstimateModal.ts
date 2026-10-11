import { useFlag } from "@/hooks/useFlag";
import { HTPR_6975_TYPED_WRITES_FLAG, HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG } from "@/lib/flags/keys";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { setTaskEstimate } from "@/lib/api/typedClient";
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
  const typedClient = useFlag(HTPR_6975_TYPED_WRITES_FLAG);
  let typedWrite: typeof setTaskEstimate | undefined;
  if (typedClient) typedWrite = setTaskEstimate;
  const boardCardFresh = useFlag(HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG);
  const { updateTaskInCache } = UpdateKanban();
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
        const response = typedWrite ? await typedWrite(body) : await axios.post("/api/estimate/setEstimate", body);
        if (boardCardFresh) {
          // Patch the board card at once, as the assignee picker does, so the
          // new size shows on Escape (HTPR-7129). A cleared size answers with a
          // message, not a row.
          try {
            const row = response.data && "estimate_index" in response.data ? response.data : undefined;
            updateTaskInCache({ estimate: row }, inViewObject.taskId, inViewObject.taskProjectId, inViewObject.sectionId);
          } catch (error) {
            console.error("HTPR-7129 board card size patch failed", error);
          }
        }
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
