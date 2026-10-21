import { type BoardTasksPayload, BOARD_TASKS_KEY, hydrateBoardSections, hydrateBoardWithPayload, isBoardPayloadHydrated } from "@/lib/firstScreen/boardPayload";
export { type BoardTasksPayload, BOARD_TASKS_KEY, hydrateBoardSections, hydrateBoardWithPayload, isBoardPayloadHydrated } from "@/lib/firstScreen/boardPayload";
import { IProject, ISection, ITask, IUser, IView } from "@/models/model";
import axios from "axios";
import type { getBoardDetail } from "@/lib/api/typedClient";
import axiosClient from "@/utils/axiosClient";
import { expandInboxApiResponse } from "@/utils/helperFunctions/helperFunctions";
import {
    requireSidebarTeams,
    SIDEBAR_TEAMS_PATH,
} from "@/utils/api/Homepage/sidebarTeamsResponse";
import { consumeEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";
import { resolveAuthorizedLocalFallback } from "@/lib/boardSync/startupRace";
import {
    getBoardReadinessTraceScope,
    markBoardReadinessPhase,
} from "@/lib/analytics/boardReadinessPhases";

export const getAllTeamsForLSidebar = async(body:any| null) => {
    if (body&&body.userId){
        try {
            const bootstrapped = await consumeEarlyAppShellBootstrapSlice<unknown[]>(
                "teams",
                body.userId,
            );
            if (Array.isArray(bootstrapped)) return requireSidebarTeams(bootstrapped);
        } catch {
        }
        const response = await axiosClient.post(SIDEBAR_TEAMS_PATH, body)
        return requireSidebarTeams(response.data);
    }
    else{
        return[]
    }
    
}

export const getCurrentUserById = async(_id:number)=>{
    const response = axios.get(`/api/users/getById`, )
    return response;
}


export const getAllTeamsMinimal = async(body:any)=>{
    const response = axios.post(`/api/teams/getAllMinimal`, body)
    return response;
}

export const updateBoardName = async(body:any)=>{
    return axios.post ("/api/projects/update", body)
}


export const archiveProjectById = async(body:any)=>{
    return axios.post ("/api/projects/archive", body)
}

export const leaveProject = async(body:any)=>{
    return axios.post ("/api/projects/leave", body)
}


export const createTeam = async(body:any)=>{
    return axios.post(`/api/teams/create`,body)
}

export const deleteProject = async(body:any)=>{
    return axios.post(`/api/projects/delete`,body)
}

export const getFirstProject = async() =>{
    return axios.get("/api/projects/getFirst")
}

export type NotificationCount = {
    all: number;
    unseen: number;
}

export const getNotificationCount = async (userId: number): Promise<NotificationCount> => {
    const response = await axios.get(`/api/notifications/getCount?userId=${userId}`)
    return response.data
}


export type ProjectsAuthorizationDecision =
  | void
  | boolean
  | { localBoardPublication: Promise<boolean> }

export const isBoardTasksPayload = (value: unknown): value is BoardTasksPayload => {
    if (!value || Array.isArray(value) || typeof value !== "object") return false
    const payload = value as Partial<BoardTasksPayload>
    return Array.isArray(payload.tasks) && Array.isArray(payload.allViews)
}

export const fetchBoardTasks = async (
    projectId:number,
    userId:number,
    signal?:AbortSignal,
    typedRead?:typeof getBoardDetail,
):Promise<BoardTasksPayload> => {
    const readinessTraceScope = getBoardReadinessTraceScope()
    markBoardReadinessPhase("boardRequestStart", readinessTraceScope)
    const earlyPayload = await consumeEarlyBoardBootstrap<BoardTasksPayload>(
        "boardTasks",
        userId,
        projectId,
    )
    if (isBoardTasksPayload(earlyPayload)) {
        markBoardReadinessPhase("boardRequestFinish", readinessTraceScope)
        return {
            project: earlyPayload.project,
            tasks: earlyPayload.tasks,
            allViews: earlyPayload.allViews,
        }
    }

    markBoardReadinessPhase("boardFallbackStart", readinessTraceScope)
    try {
        let res;
        if (typedRead) {
            res = await typedRead({ projectId, userId }, signal)
        } else {
            res = await axios.post(`/api/projects/boardTasks`,
                { projectId, userId },
                { signal },
            )
        }
        return {
            project: res.data?.project,
            tasks: res.data?.tasks ?? [],
            allViews: res.data?.allViews ?? [],
        }
    } finally {
        markBoardReadinessPhase("boardRequestFinish", readinessTraceScope)
    }
}

export const prefetchBoard = async (queryClient:any, projectId:number, userId:number):Promise<void> => {
    if (isBoardTasksPayload(queryClient.getQueryData(BOARD_TASKS_KEY(projectId, userId)))) return
    try {
        await queryClient.prefetchQuery({
            queryKey: BOARD_TASKS_KEY(projectId, userId),
            queryFn: () => fetchBoardTasks(projectId, userId),
            staleTime: 1000 * 60 * 5,
        })
    } catch {
    }
}

export const patchProjectIntoCache = (
    queryClient:any,
    projectId:number,
    payload:BoardTasksPayload,
    expectedAccountId?:number,
):IProject|null => {
    let loaded:IProject|null = null
    queryClient.setQueryData(["projectsAll"], (allData:any) => {
        if (!allData?.updatedProjects) return allData
        if (
            expectedAccountId !== undefined &&
            allData.accountId !== expectedAccountId
        ) {
            return allData
        }
        const idx = allData.updatedProjects.findIndex((p:IProject)=>p.id===projectId)
        if (idx < 0) return allData
        loaded = hydrateBoardWithPayload(allData.updatedProjects[idx], payload)
        const updatedProjects = [...allData.updatedProjects]
        updatedProjects[idx] = loaded
        return { ...allData, updatedProjects }
    })
    return loaded
}

export const loadBoardIntoCache = async (queryClient:any, projectId:number, userId:number):Promise<IProject|null> => {
    const allData:any = queryClient.getQueryData(["projectsAll"])
    if (!allData?.updatedProjects) return null
    const idx = allData.updatedProjects.findIndex((p:IProject)=>p.id===projectId)
    if (idx < 0) return null
    const existing = allData.updatedProjects[idx]
    if (isBoardPayloadHydrated(existing)) return existing

    const warm = queryClient.getQueryData(BOARD_TASKS_KEY(projectId, userId))
    const boardPayload = isBoardTasksPayload(warm) ? warm : await fetchBoardTasks(projectId, userId)
    return patchProjectIntoCache(queryClient, projectId, boardPayload, userId)
}

export const getAllProjects = async(
    user:IUser,
    slugs:any,
    options?: {
      onProjectsAuthorized?: (
        projectIds:number[],
      ) => ProjectsAuthorizationDecision | Promise<ProjectsAuthorizationDecision>;
      onCriticalBoardRequestSettled?: () => void;
      signal?: AbortSignal;
      boardPayloadPromise?: Promise<BoardTasksPayload>;
    },
)=>{
    const readinessTraceScope = getBoardReadinessTraceScope()
    const targetId = parseInt(slugs ? slugs : "")
    const boardPayloadPromise = (Number.isFinite(targetId)
      ? (options?.boardPayloadPromise ??
          fetchBoardTasks(targetId, user.id, options?.signal)).catch((error) => {
          console.error("Failed to load active board data", error)
          return null
        })
      : Promise.resolve(null)
    ).finally(() => options?.onCriticalBoardRequestSettled?.())
    const earlyProjectsPayload = Number.isFinite(targetId)
      ? await consumeEarlyBoardBootstrap<IProject[]>(
          "projectsAll",
          user.id,
          targetId,
        )
      : undefined
    const earlyProjects = Array.isArray(earlyProjectsPayload)
      ? earlyProjectsPayload
      : undefined
    let response: { data: IProject[] } | undefined
    if (earlyProjects === undefined) {
      markBoardReadinessPhase("projectsFallbackStart", readinessTraceScope)
      try {
        response = await axios.post(`/api/projects/getAll`,{
            userId:user.id,
            projectId:slugs,
          },
          { signal: options?.signal },
        )
      } finally {
        markBoardReadinessPhase("projectsRequestFinish", readinessTraceScope)
      }
    } else {
      markBoardReadinessPhase("projectsRequestFinish", readinessTraceScope)
    }
    const projects:IProject[] | undefined = earlyProjects ?? response?.data
    if (!Array.isArray(projects)) {
      throw new Error("Invalid projects response")
    }
    const authorizationDecision = await options?.onProjectsAuthorized?.(
      projects.map((project) => project.id),
    )
    const localBoardPublication = (
      authorizationDecision && typeof authorizationDecision === "object"
        ? authorizationDecision.localBoardPublication
        : Promise.resolve(authorizationDecision === true)
    ).catch((error) => {
      console.error("Failed to publish authorized local board", error)
      return false
    })
    const index = projects.findIndex((project) => project.id.toString() === targetId.toString());

    const updatedProjects = [...projects];

    const boardPayload = await boardPayloadPromise
    const authorizedLocalBoardPublished = await resolveAuthorizedLocalFallback({
      boardPayload,
      localBoardPublication,
    })
    if (index >= 0 && boardPayload) {
      updatedProjects[index] = hydrateBoardWithPayload(updatedProjects[index], boardPayload)
    }

    for (let projectIndex = 0; projectIndex < updatedProjects.length; projectIndex += 1) {
      if (projectIndex === index && boardPayload) continue
      hydrateBoardSections(updatedProjects[projectIndex])
    }

    const result = ({
      accountId:user.id,
      dataOrigin:"network" as const,
      projectsCompleteness:"all-authorized" as const,
      activeBoardPayloadLoaded:
        Number.isFinite(targetId) && index >= 0
          ? boardPayload !== null
          : undefined,
      authorizedLocalBoardPublished,
      index:index,
      updatedProjects:updatedProjects,
      notificationsCount:{ all: 0, unseen: 0 }
    })

    return result

}

export const getAllNotifications = async (userId:number)=>{
    const response = await axios.get(`/api/notifications/getAll?userId=${userId}`)

 
    return expandInboxApiResponse(response.data)
}

export const getInboxAccessibleProjectIds = async (): Promise<{
    accountId: number
    projectIds: number[]
}> => {
    const response = await axios.get<{ accountId: number; projectIds: number[] }>(
        "/api/notifications/access"
    )
    return response.data
}

export const getAgentNotifications = async (agentId: string) => {
    const response = await axios.get(`/api/agents/${agentId}/notifications`)
    const { notifications, structuredData } = response.data
    return expandInboxApiResponse({ notifications, structuredData })
}

export const getAllProjectsMinimal = async ()=>{
    const response = await axios.get(`/api/projects/getFavorites`)
    return response.data
}


export const getProjectInviteURL=async(projectId:number, userId: number)=>{
    const response  = await axios.get(`/api/invite/generatePublicInvite?projectId=${projectId}&userId=${userId}`)
    return response.data
}
