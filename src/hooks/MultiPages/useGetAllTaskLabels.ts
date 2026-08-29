
import globalAPIHandlers from "@/utils/api/global";
import { useQuery } from "@tanstack/react-query";



export const useGetAllTaskLabels = (taskId:number, initialData?:any) => {
    return useQuery({
        queryKey:["taskLabels",taskId], 
        queryFn:() => globalAPIHandlers.getAllTaskLabels(taskId),
        initialData:initialData??[]

})
}
