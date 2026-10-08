
import { getAllFollowers } from "@/utils/api/Task Detail";
import { useTaskDetailMetaField } from "@/hooks/Task Detail/useTaskDetailMetaField";



export const useGetAllFollowers = (queryKey:any, taskId:number, initialData?:any) => {
    return useTaskDetailMetaField("followers", queryKey, taskId, () => getAllFollowers(taskId), initialData);
}
