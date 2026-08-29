import { INotification } from "@/models/model";
import {
    ARCHIVED_PAGE_SIZE,
    getAllInboxArchives,
    getArchivedInboxMeta,
} from "@/utils/api/archived.ts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ArchiveBoardScope } from "@/store";

export const archivedInboxQueryKey = (
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) => [
    "archivedInbox",
    projectId ?? null,
    boardScope,
    q ?? "",
] as const;

export const archivedInboxMetaQueryKey = (
    boardScope: ArchiveBoardScope = "active",
    projectId?: number | null
) => ["archivedInboxMeta", boardScope, projectId ?? null] as const;


export const useGetAllInboxArchives = (
    initialData?: INotification[],
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) => {
    return useInfiniteQuery({
        queryKey: archivedInboxQueryKey(projectId, boardScope, q),
        queryFn: ({ pageParam }) =>
            getAllInboxArchives(
                pageParam as number | string,
                projectId,
                boardScope,
                q
            ),
        initialPageParam: 0,
        initialData:
            !projectId && !q && initialData
                ? {
                      pages: [initialData],
                      pageParams: [0],
                  }
                : undefined,
        getNextPageParam: (lastPage: INotification[]) => {
            if (lastPage.length !== ARCHIVED_PAGE_SIZE) return undefined;
            const cursorId = Number(lastPage[lastPage.length - 1]?.id);
            return Number.isFinite(cursorId) ? cursorId : undefined;
        },
        refetchOnWindowFocus:false
        })
}

export const useArchivedInboxMeta = (
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active"
) => {
    return useQuery({
        queryKey: archivedInboxMetaQueryKey(boardScope, projectId),
        queryFn: () =>
            getArchivedInboxMeta(projectId, boardScope),
        refetchOnWindowFocus: false,
    });
}
