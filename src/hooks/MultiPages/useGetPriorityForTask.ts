
import { useTaskDetailMetaField } from "@/hooks/Task Detail/useTaskDetailMetaField";
import globalAPIHandlers from "@/utils/api/global";



export const useGetPriorityForTask = (queryKey:any, taskId:number|null, initialData?:any) => {
    return useTaskDetailMetaField("priority", queryKey, taskId, () => globalAPIHandlers.getPriorityForTask(taskId), initialData);
}
