
import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";



export const useGetAllMembersForAssign = (
  queryKey:any,
  projectId:number,
  initialData?:any,
  options?: { enabled?: boolean },
) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => globalAPIHandlers.getMembersOwnersForAssignees(projectId),
        initialData:initialData??[],
        enabled: projectId > 0 && (options?.enabled ?? true),

})
}
