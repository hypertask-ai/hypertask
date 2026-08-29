
import { ILabel } from "@/models/model";
import globalAPIHandlers from "@/utils/api/global";
import { DefinedUseQueryResult, useQuery } from "@tanstack/react-query";

export const projectLabelsPrefix ="projectLabels" 

export const useGetAllProjectLabels = (
    projectId:number|null|undefined,
    initialData?:any,
    options?: { enabled?: boolean },
):DefinedUseQueryResult<ILabel[]|any> => {
    return useQuery({
        queryKey:[projectLabelsPrefix,projectId], 
        queryFn:() => globalAPIHandlers.getAllProjectLabels(projectId),
        enabled: Boolean(projectId) && (options?.enabled ?? true),
        initialData:initialData??[]

})
}
