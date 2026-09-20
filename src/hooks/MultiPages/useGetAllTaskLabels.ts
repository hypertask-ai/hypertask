
import globalAPIHandlers from "@/utils/api/global";
import type { ITaskLabel } from "@/models/model";
import { useQuery, type QueryClient } from "@tanstack/react-query";

export const taskLabelsQueryKey = (taskId: number) => ["taskLabels", taskId] as const;

export const setTaskLabelsQueryData = (
    queryClient: QueryClient,
    taskId: number,
    taskLabels: ITaskLabel[]
) => queryClient.setQueryData(taskLabelsQueryKey(taskId), taskLabels);

export const useGetAllTaskLabels = (taskId:number, initialData?:any) => {
    return useQuery({
        queryKey: taskLabelsQueryKey(taskId),
        queryFn:() => globalAPIHandlers.getAllTaskLabels(taskId),
        initialData:initialData??[]

})
}
