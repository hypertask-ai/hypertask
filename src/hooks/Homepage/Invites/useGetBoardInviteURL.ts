
import { getProjectInviteURL } from "@/utils/api/Homepage";
import {  useQuery } from "@tanstack/react-query";

export const prefixInviteForProject ="inviteURL-for-project" 
const MINUTE = 1000 * 60;
export const useGetBoardInviteURL = (projectId:number, userId: number,initialData?:any) => {
    return useQuery({
        queryKey:[prefixInviteForProject, projectId], 
        queryFn:() => getProjectInviteURL(projectId, userId),
        gcTime: 60 * MINUTE,
        refetchOnWindowFocus:true,
        refetchOnMount:true,

        
})
}
