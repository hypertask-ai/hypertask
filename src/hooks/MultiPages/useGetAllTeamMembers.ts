
import {  getAllTeamMembers } from "@/utils/api/global/apiHelpers/getAllProjectsMinimal";
import { useQuery } from "@tanstack/react-query";

import globalAPIHandlers from "@/utils/api/global";


export const useGetAllTeamMembers = (queryKey:any,teamId:string, initialData?:any) => {
    return useQuery({
        queryKey:queryKey, 
        queryFn:() => globalAPIHandlers.getAllTeamMembers(teamId),
        enabled:Boolean(teamId),
        initialData:initialData??[]

})
}
