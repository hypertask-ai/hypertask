
import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";



export const useGetPriorityForTask = (queryKey:any, taskId:number|null, initialData?:any) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => globalAPIHandlers.getPriorityForTask(taskId),
        initialData:initialData??[]

})
}
