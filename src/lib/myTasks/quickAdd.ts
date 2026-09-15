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

const friendlyAxiosError = (error: unknown, fallback: string): Error => {
  if (axios.isAxiosError(error)) {
    const message =
      (typeof error.response?.data?.message === "string" &&
        error.response.data.message) ||
      (typeof error.response?.data?.error === "string" &&
        error.response.data.error) ||
      fallback;
    return new Error(message);
  }
  if (error instanceof Error) return error;
  return new Error(fallback);
};

export async function fetchMyTasksQuickAddSectionDefaults(
  projectId: number,
): Promise<MyTasksQuickAddSectionDefaults> {
  let response;
  try {
    response = await axios.get("/api/tasks/createGlobally", {
      params: { projectId, position: "top" },
    });
  } catch (error) {
    throw friendlyAxiosError(error, "Could not load a column for that board");
  }
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
  let result;
  try {
    result = await createNewTaskGloballyAPIHandler({
      userId: args.currentUser.id,
      projectId: args.project.id,
      projectIdentifier: args.project.uniqueIdentifier ?? "TASK",
      title: args.title,
      ranking: args.section.ranking,
      sectionId: args.section.sectionId,
      section_title: args.section.sectionTitle,
      assignees: [args.currentUser],
    });
  } catch (error) {
    throw friendlyAxiosError(error, "Could not create the task");
  }
  if (result?.error) {
    throw new Error("Could not create the task");
  }
  const id = Number(result?.resposne?.newTask?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Task was created but the response had no id");
  }
  return { id };
}
