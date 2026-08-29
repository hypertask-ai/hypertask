
import { getAllFollowers } from "@/utils/api/Task Detail";
import { useQuery } from "@tanstack/react-query";



export const useGetAllFollowers = (queryKey:any, taskId:number, initialData?:any) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => getAllFollowers(taskId),
        initialData:initialData??[]

})
}
