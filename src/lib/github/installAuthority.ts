import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import hasTeamOwnerOrProjectAdminAccess from "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess";

import {
  fetchGithubOrgMembership,
  type GithubUser,
  type GithubUserInstallation,
} from "./userApi";

export type BoardGithubAdmin = { projectId: number; teamId: string };

type ProjectReader = Pick<Prisma.TransactionClient, "project">;

export async function findBoardGithubAdmin(
  userId: number,
  projectId: number,
  db: ProjectReader = prisma,
): Promise<BoardGithubAdmin | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, status: "Normal", teamId: { not: null } },
    select: {
      teamId: true,
      team: {
        select: {
          googleAccountId: true,
          googleAccount: { select: { userId: true } },
          members: {
            where: { userId, status: "Accepted" },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!project?.teamId || !project.team) return null;

  const isTeamOwner = project.team.googleAccount.userId === userId;
  if (!isTeamOwner && project.team.members.length === 0) return null;

  const allowed = await hasTeamOwnerOrProjectAdminAccess(
    userId,
    undefined,
    project.team,
    project.teamId,
    String(projectId),
  );
  return allowed ? { projectId, teamId: project.teamId } : null;
}

export type GithubOwnerProof =
  | "verified"
  | "wrong_app"
  | "installation_suspended"
  | "account_mismatch"
  | "org_owner_required"
  | "org_membership_pending"
  | "org_verification_blocked"
  | "github_unavailable";

export async function proveGithubInstallationOwner(
  input: {
    appId: string;
    githubUser: GithubUser;
    installation: GithubUserInstallation;
    userToken: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<GithubOwnerProof> {
  const { appId, githubUser, installation, userToken } = input;
  if (installation.appId !== appId) return "wrong_app";
  if (installation.suspended) return "installation_suspended";

  if (installation.accountType === "User") {
    return installation.accountId === githubUser.id ? "verified" : "account_mismatch";
  }

  const membership = await fetchGithubOrgMembership(
    userToken,
    installation.accountLogin,
    fetcher,
  );
  if (membership.httpStatus === 403) return "org_verification_blocked";
  if (membership.httpStatus === 404) return "org_owner_required";
  if (!("organizationId" in membership)) return "github_unavailable";
  if (membership.organizationId !== installation.accountId) return "org_owner_required";
  if (membership.state === "pending") return "org_membership_pending";
  return membership.state === "active" && membership.role === "admin"
    ? "verified"
    : "org_owner_required";
}
