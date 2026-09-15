import type { IProject, IUser } from "@/models/model";
import createNewTaskGloballyAPIHandler from "@/utils/api/global/apiHelpers/createTaskGloballycontroller";
import axios from "axios";

export type MyTasksQuickAddSectionDefaults = {
  sectionId: number;
  sectionTitle: string;
  ranking: string;
};

export {
  myTasksQuickAddLikelyVisible,
  resolveMyTasksQuickAddBoardId,
} from "./quickAddHelpers";

export async function fetchMyTasksQuickAddSectionDefaults(
  projectId: number,
): Promise<MyTasksQuickAddSectionDefaults> {
  const response = await axios.get("/api/tasks/createGlobally", {
    params: { projectId, position: "top" },
  });
  const sectionId = Number(response.data?.sectionId);
  const ranking = response.data?.ranking;
  const sectionTitle = response.data?.section;
  if (
    !Number.isSafeInteger(sectionId) ||
    sectionId <= 0 ||
    typeof ranking !== "string" ||
    typeof sectionTitle !== "string"
  ) {
    throw new Error("Could not load a column for that board");
  }
  return { sectionId, sectionTitle, ranking };
}

export async function createMyTasksQuickAddTask(args: {
  title: string;
  project: Pick<IProject, "id" | "uniqueIdentifier">;
  currentUser: IUser;
  section: MyTasksQuickAddSectionDefaults;
}): Promise<{ id: number }> {
  const result = await createNewTaskGloballyAPIHandler({
    userId: args.currentUser.id,
    projectId: args.project.id,
    projectIdentifier: args.project.uniqueIdentifier ?? "TASK",
    title: args.title,
    ranking: args.section.ranking,
    sectionId: args.section.sectionId,
    section_title: args.section.sectionTitle,
    assignees: [args.currentUser],
  });
  if (result?.error) {
    throw new Error("Could not create the task");
  }
  const id = Number(result?.resposne?.newTask?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Task was created but the response had no id");
  }
  return { id };
}
