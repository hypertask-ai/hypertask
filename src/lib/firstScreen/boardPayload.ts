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

export const BOARD_TASKS_KEY = (projectId:number, userId:number) =>
    ["boardTasks", userId, projectId] as const

