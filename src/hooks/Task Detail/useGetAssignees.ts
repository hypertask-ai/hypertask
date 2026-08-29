
import { fetchAssignedUsers } from "@/utils/api/Task Detail";
import { useQuery } from "@tanstack/react-query";



export const useGetAllAssignees = (queryKey:any, taskId:number, initialData?:any) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => fetchAssignedUsers(taskId),
        initialData:initialData??[]

})
}
