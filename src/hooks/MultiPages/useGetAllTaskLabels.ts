
import globalAPIHandlers from "@/utils/api/global";
import { useTaskDetailMetaField } from "@/lib/useTaskDetailMetaField";



export const useGetAllTaskLabels = (taskId:number, initialData?:any) => {
    return useTaskDetailMetaField("labels", ["taskLabels",taskId], taskId, () => globalAPIHandlers.getAllTaskLabels(taskId), initialData);
}
