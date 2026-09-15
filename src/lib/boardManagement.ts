import type { IProject } from "@/models/model";

export const canManageBoardLifecycle = (project: IProject, userId: number) =>
  String(project.ownerId) === String(userId) ||
  (project.members ?? []).some(
    (member) =>
      member.userId === userId &&
      member.status === "Accepted" &&
      member.role === "Admin" &&
      !member.agentId,
  );

export const canLeaveBoard = (project: IProject, userId: number) =>
  // Missing ownerId must not look like "everyone can leave" (HTPR-6471).
  project.ownerId !== null &&
  project.ownerId !== undefined &&
  String(project.ownerId) !== "" &&
  String(project.ownerId) !== String(userId);

export const archivedProjectsForTeam = (
  projects: IProject[],
  teamId: string | null,
  ownerId: number | null,
) => {
  if (!teamId || !ownerId) return [];

  return projects
    .filter(
      (project) =>
        String(project.teamId) === String(teamId) &&
        String(project.ownerId) === String(ownerId),
    )
    .sort((left, right) =>
      (left.title ?? left.name ?? "").localeCompare(
        right.title ?? right.name ?? "",
      ),
    );
};
