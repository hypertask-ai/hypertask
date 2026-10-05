import type { IProject, IProjectsAll, IUser } from "@/models/model";
import type { FirstScreenInitialModel, FirstScreenWireValue } from "./contract";
import type { BoardTasksPayload } from "./boardPayload";

export const BOARD_FIRST_SCREEN_FLAG = "htpr-6934-server-first-screen";
export const BOARD_DOCUMENT_ROUTE_HEADER = "x-ht-board-document-route";
export const BOARD_DOCUMENT_TIMEOUT_MS = 800;

export type BoardDocument = FirstScreenInitialModel<FirstScreenWireValue> & {
  data: {
    user: IUser;
    payload: BoardTasksPayload;
    projects: IProjectsAll;
    projectId: number;
  };
};

export function getBoardDocument(snapshot: FirstScreenInitialModel<FirstScreenWireValue> | null, accountId: number, projectId?: number | null): BoardDocument | null {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.scope.accountId !== accountId || snapshot.scope.route !== "/project" ||
      snapshot.authorization.outcome !== "authorized" || snapshot.flags.accountId !== accountId ||
      !Number.isFinite(Date.parse(snapshot.fetchedAt)) || snapshot.completeness !== "complete" ||
      snapshot.flags.values[BOARD_FIRST_SCREEN_FLAG] !== true) return null;
  const data = snapshot.data as unknown as BoardDocument["data"];
  return data?.user?.id === accountId && data.projects?.accountId === accountId &&
    data.payload?.project?.id === data.projectId &&
    (projectId === undefined || projectId === data.projectId)
    ? snapshot as BoardDocument : null;
}

// A scoped document proves one board, never absence/revocation of other boards.
export function mergeBoardDocumentProjects(current: IProjectsAll | undefined, incoming: IProjectsAll): IProjectsAll {
  if (!current || current.accountId !== incoming.accountId) return incoming;
  const active = incoming.updatedProjects[0];
  const projects = current.updatedProjects.filter(project => project.id !== active.id);
  return { ...current, ...incoming, updatedProjects: [active, ...projects],
    projectsCompleteness: current.projectsCompleteness === "all-authorized" ? "all-authorized" : "active-board-only" };
}

export function projectBoardDocumentUser(user: IUser): IUser {
  const { id, uid, displayName, photoURL, email, joinedAt, UserSettingId, accountId, UserSetting } = user;
  return JSON.parse(JSON.stringify({ id, uid, displayName, photoURL, email, joinedAt, UserSettingId, accountId,
    UserSetting: UserSetting ? { id: UserSetting.id, onboardingTourStatus: UserSetting.onboardingTourStatus,
      onboardingTutorialStatus: UserSetting.onboardingTutorialStatus, trialStatus: UserSetting.trialStatus, notification: UserSetting.notification } : undefined })) as IUser;
}

export function projectBoardDocumentPayload(payload: BoardTasksPayload): BoardTasksPayload {
  // Start with the API's exact authorized projection, then remove non-display
  // billing/instruction fields. Never broaden its task, section or view scope.
  const wire = JSON.parse(JSON.stringify(payload)) as BoardTasksPayload;
  const project = wire.project as (IProject & Record<string, any>) | undefined;
  if (project) {
    delete project.ai_custom_instructions;
    if (project.team) {
      delete (project.team as unknown as Record<string, unknown>).stripe_customer_id;
      delete (project.team as unknown as Record<string, unknown>).googleAccount;
      delete project.team.allowedEmailDomains;
      project.team.subscriptionPlan?.forEach(plan => { delete (plan as unknown as Record<string, unknown>).subscriptionId; });
    }
    if (project.owner) delete project.owner.email;
    project.members?.forEach(member => { if (member.user) delete member.user.email; });
  }
  return wire;
}
