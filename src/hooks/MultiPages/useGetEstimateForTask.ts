
import { useTaskDetailMetaField } from "@/hooks/Task Detail/useTaskDetailMetaField";
import globalAPIHandlers from "@/utils/api/global";



export const useGetEstimateForTask = (queryKey:any, taskId:number|null, initialData?:any) => {
    return useTaskDetailMetaField("estimate", queryKey, taskId, () => globalAPIHandlers.getEstimateForTask(taskId), initialData);
}
