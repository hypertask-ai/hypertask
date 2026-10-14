
import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";



export const useGetSectionsMoveTask = (queryKey:any, projectId:number, initialData?:any, enabled = true) => {
    const result = useQuery({
        queryKey:queryKey,
        queryFn:() => globalAPIHandlers.getSectionsForMoveTask(projectId),
        enabled: Number.isFinite(projectId) && enabled,
        initialData:initialData??[]
    });
    return {
        ...result,
        data: Array.isArray(result.data) ? result.data : []
    };
}