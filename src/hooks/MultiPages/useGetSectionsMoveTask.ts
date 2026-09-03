
import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";



export const useGetSectionsMoveTask = (queryKey:any, projectId:number, initialData?:any, enabled = true) => {
    const result = useQuery({
        queryKey:queryKey,
        queryFn:() => globalAPIHandlers.getSectionsForMoveTask(projectId),
        // HTPR-4879: without a projectId this POSTed an empty body and came back
        // with nothing useful, one wasted serverless call per task open.
        enabled: Number.isFinite(projectId) && enabled,
        initialData:initialData??[]
    });
    // Ensure data is always an array, even if query fails or returns non-array
    return {
        ...result,
        data: Array.isArray(result.data) ? result.data : []
    };
}