import {  getFilteredSections,  } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { IProject, ISection, ITask, IUser, IView } from "@/models/model";
import { getCurrentProject } from "@/utils/helperFunctions/helperFunctions";
import axios from "axios";
import axiosClient from "@/utils/axiosClient";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { expandInboxApiResponse } from "@/utils/helperFunctions/helperFunctions";
import {
    requireSidebarTeams,
    SIDEBAR_TEAMS_PATH,
} from "@/utils/api/Homepage/sidebarTeamsResponse";
import { consumeEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { resolveAuthorizedLocalFallback } from "@/lib/boardSync/startupRace";
import {
    getBoardReadinessTraceScope,
    markBoardReadinessPhase,
} from "@/lib/analytics/boardReadinessPhases";

// =================== GET ALL TEAMS FOR SIDEBAR
export const getAllTeamsForLSidebar = async(body:any| null) => {
    if (body&&body.userId){
        // axiosClient, not bare axios: this route is one of the few gated on ht_session,
        // so a stale session 401s here while every userId-in-body route still succeeds.
        // Bare axios skips the SESSION_REQUIRED interceptor (HTPR-4182), the rejection is
        // swallowed by react-query's initialData, and the sidebar silently renders
        // favorites and nothing else, which reads as "all my boards are gone".
        const response = await axiosClient.post(SIDEBAR_TEAMS_PATH, body)
        return requireSidebarTeams(response.data);
    }
    else{
        return[]
    }
    
}

// =================== GET ALL TEAMS FOR SIDEBAR
export const getCurrentUserById = async(id:any)=>{
    const response = axios.get(`/api/users/getById?userId=${id}`, )
    return response;
}


// =================== GET ALL TEAMS MINIMAL
export const getAllTeamsMinimal = async(body:any)=>{
    const response = axios.post(`/api/teams/getAllMinimal`, body)
    return response;
}

// ================== UPDATE BOARD NAME
export const updateBoardName = async(body:any)=>{
    return axios.post ("/api/projects/update", body)
}


// ================== ARCHIVE PROJECT
export const archiveProjectById = async(body:any)=>{
    return axios.post ("/api/projects/archive", body)
}

// ================== LEAVE PROJECT
export const leaveProject = async(body:any)=>{
    return axios.post ("/api/projects/leave", body)
}


// ================== CREATE TEAM
export const createTeam = async(body:any)=>{
    return axios.post(`/api/teams/create`,body)
}

// ================== DELETE project
export const deleteProject = async(body:any)=>{
    return axios.post(`/api/projects/delete`,body)
}

// =================== GET FIRST PROJECT
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


export type BoardTasksPayload = {
    project?: IProject;
    tasks: ITask[];
    allViews: IView[];
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

// HTPR-3811: getAll no longer ships every board's tasks. Fetch one board's tasks
// (same shape getAll used to nest) plus its saved views on demand.
export const fetchBoardTasks = async (
    projectId:number,
    userId:number,
    signal?:AbortSignal,
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
        const res = await axios.post(`/api/projects/boardTasks`,
            { projectId, userId },
            { signal },
        )
        return {
            project: res.data?.project,
            tasks: res.data?.tasks ?? [],
            allViews: res.data?.allViews ?? [],
        }
    } finally {
        markBoardReadinessPhase("boardRequestFinish", readinessTraceScope)
    }
}

// Compute sections / firstTask / filteredSections from project.tasks (mutates project).
// Boards with no tasks loaded yet come back with empty sections until hydrated.
export const hydrateBoardSections = (project:IProject):IProject => {
    const { _sections, firstTask } = getCurrentProject(project) as {
        _sections: ISection[];
        firstTask: ITask | null;
    }
    project.sections = _sections
    project.firstTask = firstTask
    let filtered = getFilteredSections(_sections, project)
    filtered = getAppliedSubtaskSections(filtered, project)
    filtered = getFilteredEmptySections(filtered, project)
    project.filteredSections = filtered
    return project
}

// A board is hydrated once its tasks are loaded, plus its allViews when it has a
// project_view (project_view is optional in the schema — a board without one has
// no allViews to load, so tasks alone means hydrated; requiring allViews there
// would loop the hydrate effect on every render).
export const isBoardPayloadHydrated = (project:IProject):boolean =>
    Boolean(project.tasks) && (!project.project_view || Array.isArray(project.project_view.allViews))

export const hydrateBoardWithPayload = (project:IProject, payload:BoardTasksPayload):IProject => {
    const hydratedMetadata = payload.project
        ? { ...project, ...payload.project }
        : project
    const projectView = hydratedMetadata.project_view
        ? { ...hydratedMetadata.project_view, allViews: payload.allViews }
        : hydratedMetadata.project_view
    return hydrateBoardSections({
        ...hydratedMetadata,
        tasks: payload.tasks,
        project_view: projectView,
    })
}

// Side cache of a board's tasks/views, keyed per board. Filled by the background
// prefetch WITHOUT touching ["projectsAll"], so warming other boards never
// disturbs the board the user is currently looking at.
export const BOARD_TASKS_KEY = (projectId:number, userId:number) =>
    ["boardTasks", userId, projectId] as const

// Warm one board's tasks/views into the side cache (background, non-blocking). No-op
// if already warm or already hydrated in the main blob.
export const prefetchBoard = async (queryClient:any, projectId:number, userId:number):Promise<void> => {
    if (isBoardTasksPayload(queryClient.getQueryData(BOARD_TASKS_KEY(projectId, userId)))) return
    try {
        await queryClient.prefetchQuery({
            queryKey: BOARD_TASKS_KEY(projectId, userId),
            queryFn: () => fetchBoardTasks(projectId, userId),
            staleTime: 1000 * 60 * 5,
        })
    } catch {
        // background warm-up; failures are retried lazily on actual open
    }
}

// Lazy-load one board's tasks/views into the ["projectsAll"] cache and compute its
// sections. Uses the prefetched side cache when warm (no network). Returns the
// hydrated project (or the existing one if already loaded).
export const loadBoardIntoCache = async (queryClient:any, projectId:number, userId:number):Promise<IProject|null> => {
    const allData:any = queryClient.getQueryData(["projectsAll"])
    if (!allData?.updatedProjects) return null
    const idx = allData.updatedProjects.findIndex((p:IProject)=>p.id===projectId)
    if (idx < 0) return null
    const existing = allData.updatedProjects[idx]
    if (isBoardPayloadHydrated(existing)) return existing // already hydrated

    const warm = queryClient.getQueryData(BOARD_TASKS_KEY(projectId, userId))
    const boardPayload = isBoardTasksPayload(warm) ? warm : await fetchBoardTasks(projectId, userId)
    const loaded = hydrateBoardWithPayload(existing, boardPayload)
    const updatedProjects = [...allData.updatedProjects]
    updatedProjects[idx] = loaded
    queryClient.setQueryData(["projectsAll"], { ...allData, updatedProjects })
    return loaded
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
    // The active board is the visible content. Start it in the same turn as the
    // lightweight authorization metadata instead of serializing it behind
    // /getAll. The boardTasks route enforces its own membership check.
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
    // This response remains the account-wide authorization boundary. A keyed
    // IndexedDB snapshot may already be visible while it is in flight. Await
    // revocation cleanup, but never add local-read latency to a network winner.
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

    // Hydrate ONLY the active board's tasks/views for fast first paint. Other boards
    // load lazily when first opened (loadBoardIntoCache).
    const boardPayload = await boardPayloadPromise
    // Only an unavailable network payload needs to wait for the local fallback
    // decision. A successful network winner must never inherit IndexedDB time.
    const authorizedLocalBoardPublished = await resolveAuthorizedLocalFallback({
      boardPayload,
      localBoardPublication,
    })
    if (index >= 0 && boardPayload) {
      updatedProjects[index] = hydrateBoardWithPayload(updatedProjects[index], boardPayload)
    }

    // Compute sections for every board. Active board has tasks -> real columns;
    // unopened boards have no tasks yet -> empty until hydrated on open. The
    // active board was already hydrated above, so do not process its full task
    // list a second time on the startup path.
    for (let projectIndex = 0; projectIndex < updatedProjects.length; projectIndex += 1) {
      if (projectIndex === index && boardPayload) continue
      hydrateBoardSections(updatedProjects[projectIndex])
    }

    const result = ({
      accountId:user.id,
      dataOrigin:"network" as const,
      activeBoardPayloadLoaded:
        Number.isFinite(targetId) && index >= 0
          ? boardPayload !== null
          : undefined,
      authorizedLocalBoardPublished,
      index:index,
      updatedProjects:updatedProjects,
      // Notification badges own a separate, account-scoped React Query. The
      // board payload keeps this legacy field for mutation consumers, but must
      // not wait for an unrelated request before publishing usable board data.
      notificationsCount:{ all: 0, unseen: 0 }
    })

    return result

}

// get all notifications for a user 
export const getAllNotifications = async (userId:number)=>{
    const response = await axios.get(`/api/notifications/getAll?userId=${userId}`)
    // const tabs = (response.data as ISplit[]).map((item: string | any[], index: number) => ({ 
    //     idx: index, 
    //     project: index==0?"All":(item[0].project?.title??item[0].project?.name), 
    //     length:item.length }));
    // const tabs:any = [];
    // const data:any = [];
    // (response.data as ISplit[]).forEach(((x,index)=>{
    //   tabs.push({
    //     idx:index,
    //     project:x.splitName,
    //     length:x.notifications.length
    //     })
    //     data.push(x.notifications)

    // }));
        // console.log("🚀 ~ getAllNotifications ~  {data:response.data,tabs:tabs }:",  {data:response.data,tabs:tabs })
 
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
