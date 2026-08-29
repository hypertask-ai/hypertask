
import globalConstants from "@/lib/constants";
import { getTrashByProjectIdAPI } from "@/utils/api/Trash/getTrashByProjectIdAPI";
import { useQuery } from "@tanstack/react-query";



export const useGetTrashByProjectId = ( projectId:number, initialData?:any) => {
    return useQuery({
        queryKey:[globalConstants.TrashKeyPrefix, projectId], 
        queryFn:() => getTrashByProjectIdAPI(projectId),
        initialData:initialData??[]

})
}
