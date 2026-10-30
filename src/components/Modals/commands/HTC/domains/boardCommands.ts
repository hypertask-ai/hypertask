import { CommandMode } from "@/models/enums";
import type { IProject } from "@/models/model";
import type { ICommandList } from "../HTCTypes";

type BoardCommandOptions = {
  projects: IProject[] | null | undefined;
  currentProject?: IProject | null;
  onMyTasks: boolean;
  myTasksViewsEnabled: boolean;
  myTasksFilterParityEnabled: boolean;
  myTasksScopesEnabled: boolean;
  columnArchiveEnabled: boolean;
  context?: string;
};

export function boardCommands({
  projects, currentProject, onMyTasks, myTasksViewsEnabled,
  myTasksFilterParityEnabled, myTasksScopesEnabled, columnArchiveEnabled, context,
}: BoardCommandOptions): ICommandList[] {
  const availableProjects: IProject[] = Array.isArray(projects)
    ? projects
    : [];
  const boardCommands: ICommandList[] = availableProjects
    .filter((project) => project.id !== currentProject?.id)
    .slice(0, 50)
    .map((project) => ({
      key: `gotoBoard-${project.id}`,
      name: `Go to board: ${project.title}`,
      payload: String(project.id),
      commandMode: CommandMode.GoToBoard,
      keywords: `${project.title} board project go open switch`,
    }));
  let scopeCommand: ICommandList | undefined;
  if (onMyTasks && myTasksViewsEnabled && myTasksFilterParityEnabled) {
    scopeCommand = {
      key: "myTasksScope",
      name: "Scope",
      commandMode: CommandMode.GoToBoard,
      keywords: "scope boards project select filter my tasks",
    };
  }
  if (scopeCommand) boardCommands.unshift(scopeCommand);
  if (columnArchiveEnabled && currentProject && (context === "Kanban" || context === "Task")) {
    boardCommands.push({
      key: "archiveColumn",
      name: "Archive all tickets in a column",
      commandMode: CommandMode.ArchiveColumn,
      keywords: "archive every all tickets tasks column section bulk clear",
    });
  }
  const myTasksPickerCommands: ICommandList[] = [];
  if (onMyTasks) {
    if (myTasksScopesEnabled) myTasksPickerCommands.push({
      key: "myTasksInvolvement", name: "Involvement", commandMode: CommandMode.GoToBoard,
      keywords: "involvement assigned created mentioned watching my tasks",
    });
    if (myTasksViewsEnabled) myTasksPickerCommands.push({
      key: "myTasksSort", name: "Sort", commandMode: CommandMode.GoToBoard,
      keywords: "sort order field direction my tasks",
    });
    myTasksPickerCommands.push({
      key: "myTasksGroup", name: "Group by", commandMode: CommandMode.GoToBoard,
      keywords: "group due date time board my tasks",
    });
  }
  boardCommands.push(...myTasksPickerCommands);
  return boardCommands;
}
