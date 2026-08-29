import prisma from "@/lib/prisma";
import { getBoardAgentMembers } from "@/utils/controllers/agents/boardMembers";

export interface ProjectMemberItem {
  id: number;
  displayName: string;
  email: string;
}

export interface ProjectAgentItem {
  id: string;
  displayName: string;
  owner: {
    id: number;
    displayName: string;
    email: string;
  };
}

export type GetProjectMembersResult =
  | { members: (ProjectMemberItem | ProjectAgentItem)[]; error: null }
  | { members: null; error: { status: number; message: string } };

/**
 * Fetches project members (owner + human members + board agent members).
 * SECURITY: Returns ONLY users/agents scoped to the specified project.
 */
export async function getProjectMembers(
  projectId: number,
  excludeUserId?: number,
): Promise<GetProjectMembersResult> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
    },
    include: {
      owner: true,
      members: {
        where: { agentId: null },
        include: {
          user: true,
        },
      },
    },
  });

  if (!project) {
    return {
      members: null,
      error: { status: 404, message: `Project with ID ${projectId} not found` },
    };
  }

  const ownerUser = project.owner;
  const memberUsers = project.members.map((m) => m.user);

  const allUsers = [
    ownerUser,
    ...memberUsers.filter((u) => u.id !== ownerUser.id),
  ];

  const members: (ProjectMemberItem | ProjectAgentItem)[] = allUsers
    .filter((u) => excludeUserId == null || u.id !== excludeUserId)
    .map((u) => ({
      id: u.id,
      displayName: u.displayName ?? "",
      email: u.email ?? "",
    }));

  const boardAgentRows = await getBoardAgentMembers(projectId);
  for (const row of boardAgentRows) {
    members.push({
      id: row.agent.id,
      displayName: row.agent.displayName,
      owner: {
        id: row.user.id,
        displayName: row.user.displayName ?? "",
        email: row.user.email ?? "",
      },
    });
  }

  return { members, error: null };
}
