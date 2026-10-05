import type { IProject, ISection, ITask, IView } from "@/models/model";
import { getCurrentProject } from "@/utils/helperFunctions/helperFunctions";
import { getFilteredSections } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";

export type BoardTasksPayload = {
    project?: IProject;
    tasks: ITask[];
    allViews: IView[];
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
// project_view (project_view is optional in the schema; a board without one has
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

