
import { getAllFollowers } from "@/utils/api/Task Detail";
import { useTaskDetailMetaField } from "@/lib/useTaskDetailMetaField";



export const useGetAllFollowers = (queryKey:any, taskId:number, initialData?:any) => {
    return useTaskDetailMetaField("followers", queryKey, taskId, () => getAllFollowers(taskId), initialData);
}
