import axios from "axios";
import type { ArchiveBoardScope } from "@/store";

export const ARCHIVED_PAGE_SIZE = 50;

export type ArchivedProjectCount = {
    projectId: number;
    name: string;
    count: number;
};

export type ArchivedMeta = {
    total: number;
    byProject: ArchivedProjectCount[];
};

// ================== GET ARCHIVED PROJECTS
export const getArchivedProjects = async(id:number)=>{
    return axios.get(`/api/projects/getArchived?userId=${id}`)
}


// ================== GET ALL ARCHIVES 
export const getAllArchives = async (
    userId:number,
    cursorId:number | string = 0,
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) => {
    const params = new URLSearchParams({
        userId: userId.toString(),
        cursor: cursorId.toString(),
        boardScope,
    });

    if (projectId) params.set("projectId", projectId.toString());
    if (q?.trim()) params.set("q", q.trim());

    const response = await axios.get(`/api/tasks/getArchivedTasks?${params.toString()}`)
    return response.data
}

export const getArchivedTasksMeta = async (
    userId: number,
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active"
): Promise<ArchivedMeta> => {
    const params = new URLSearchParams({
        userId: userId.toString(),
        mode: "meta",
        boardScope,
    });

    if (projectId) params.set("projectId", projectId.toString());

    const response = await axios.get(`/api/tasks/getArchivedTasks?${params.toString()}`);
    return response.data;
};

export const getAllInboxArchives = async (
    cursorId:number | string = 0,
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active",
    q?: string
) =>{
    const params = new URLSearchParams({
        cursor: cursorId.toString(),
        boardScope,
    });

    if (projectId) params.set("projectId", projectId.toString());
    if (q?.trim()) params.set("q", q.trim());

    const response = await axios.get(`/api/notifications/getAllInbox?${params.toString()}`)
    return response.data
}

export const getArchivedInboxMeta = async (
    projectId?: number | null,
    boardScope: ArchiveBoardScope = "active"
): Promise<ArchivedMeta> => {
    const params = new URLSearchParams({
        mode: "meta",
        boardScope,
    });

    if (projectId) params.set("projectId", projectId.toString());

    const response = await axios.get(`/api/notifications/getAllInbox?${params.toString()}`);
    return response.data;
};
