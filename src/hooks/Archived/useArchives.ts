
import { ITask } from "@/models/model";
import {
    ARCHIVED_PAGE_SIZE,
    getAllArchives,
    getArchivedTasksMeta,
} from "@/utils/api/archived.ts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ArchiveBoardScope } from "@/store";

export const archivedTasksQueryKey = (
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) => [
    "archived",
    projectId ?? null,
    boardScope,
    q ?? "",
] as const;

export const archivedTasksMetaQueryKey = (
    boardScope: ArchiveBoardScope = "active",
    projectId?: number | null
) => ["archivedMeta", boardScope, projectId ?? null] as const;

export const useGetAllArchivedTasks = (
    userId: number,
    initialData?: ITask[],
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) => {
    return useInfiniteQuery({
        queryKey: archivedTasksQueryKey(projectId, boardScope, q),
        queryFn: ({ pageParam }) =>
            getAllArchives(
                userId,
                pageParam as number | string,
                projectId,
                boardScope,
                q
            ),
        initialPageParam: 0,
        initialData:
            !projectId && !q && boardScope === "active" && initialData
                ? {
                      pages: [initialData],
                      pageParams: [0],
                  }
                : undefined,
        getNextPageParam: (lastPage: ITask[]) => {
            if (lastPage.length !== ARCHIVED_PAGE_SIZE) return undefined;
            return lastPage[lastPage.length - 1]?.id;
        },
        refetchOnWindowFocus:false,
        enabled: Boolean(userId),
    })
}

export const useArchivedTasksMeta = (
    userId: number,
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active"
) => {
    return useQuery({
        queryKey: archivedTasksMetaQueryKey(boardScope, projectId),
        queryFn: () =>
            getArchivedTasksMeta(userId, projectId, boardScope),
        refetchOnWindowFocus: false,
        enabled: Boolean(userId),
    });
}
