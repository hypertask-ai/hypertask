
import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";



export const useGetEstimateForTask = (queryKey:any, taskId:number|null, initialData?:any) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => globalAPIHandlers.getEstimateForTask(taskId),
        initialData:initialData??[]

})
}
