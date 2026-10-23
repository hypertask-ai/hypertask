import { createHash } from "node:crypto";

import type { BoardGithubRepository, GithubInstallation, Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import { listInstallationRepositories, type GithubInstallationRepository } from "./appApi";
import { findBoardGithubAdmin } from "./installAuthority";

type BoardGithubDatabase = Pick<Prisma.TransactionClient, "project" | "githubInstallation" | "boardGithubRepository">;
type Dependencies = { prisma?: typeof prisma; fetcher?: typeof fetch };
type LiveRepository = GithubInstallationRepository & { installationId: string };

export class BoardGithubSettingsError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    public readonly repositoryIds?: string[],
  ) {
    super(error);
  }
}

async function requireBoardAdmin(userId: number, projectId: number, db: BoardGithubDatabase) {
  const board = await db.project.findUnique({ where: { id: projectId }, select: { id: true, status: true } });
  if (!board || board.status !== "Normal") throw new BoardGithubSettingsError(404, "not_found");
  const admin = await findBoardGithubAdmin(userId, projectId, db);
  if (!admin) throw new BoardGithubSettingsError(403, "board_access_denied");
  return admin;
}

function repositoryVersion(rows: BoardGithubRepository[]): string {
  return createHash("sha256").update(JSON.stringify(
    rows.filter((row) => row.provenance === "installed")
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => [row.id, row.repositoryId, row.fullName, row.installationId, row.activatedAt, row.revokedAt]),
  )).digest("hex");
}

async function liveRepositories(installations: GithubInstallation[], fetcher: typeof fetch): Promise<LiveRepository[]> {
  const repositories: LiveRepository[] = [];
  for (const installation of installations) {
    const live = await listInstallationRepositories(installation.id, fetcher);
    repositories.push(...live.map((repository) => ({ ...repository, installationId: installation.id })));
  }
  return repositories;
}

async function readBoardSettings(
  userId: number,
  projectId: number,
  teamId: string,
  db: BoardGithubDatabase,
  fetcher: typeof fetch,
) {
  const rows = await db.boardGithubRepository.findMany({ where: { projectId } });
  const connected = rows.filter((row) => row.revokedAt === null);
  const installations = await db.githubInstallation.findMany({ where: { teamId, revokedAt: null }, orderBy: { id: "asc" } });
  const mine = installations.filter((installation) => installation.installedByUserId === userId);
  const needed = installations.filter((installation) =>
    installation.installedByUserId === userId || connected.some((row) => row.installationId === installation.id),
  );
  let live: LiveRepository[] = [];
  let githubUnavailable = false;
  try {
    live = await liveRepositories(needed, fetcher);
  } catch {
    githubUnavailable = true;
  }
  const candidates = live.filter((repository) =>
    !repository.isFork &&
    mine.some((installation) => installation.id === repository.installationId) &&
    !connected.some((row) => row.repositoryId === repository.id || row.fullName === repository.fullName),
  );
  const reservations = candidates.length > 0 ? await db.boardGithubRepository.findMany({
    where: {
      revokedAt: null,
      projectId: { not: projectId },
      OR: [
        { repositoryId: { in: candidates.map((repository) => repository.id) } },
        { fullName: { in: candidates.map((repository) => repository.fullName) } },
      ],
    },
  }) : [];
  const seen = new Set<string>();
  return {
    projectId,
    version: repositoryVersion(rows),
    canConnect: mine.length > 0,
    installations: installations.map((installation) => ({
      id: installation.id,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      installedByMe: installation.installedByUserId === userId,
    })),
    connected: connected.map((row) => ({
      repositoryId: row.repositoryId,
      fullName: row.fullName,
      provenance: row.provenance,
      installationId: row.installationId,
      isPrivate: row.provenance === "legacy" ? null : live.find((repository) =>
        repository.id === row.repositoryId && repository.installationId === row.installationId,
      )?.isPrivate ?? null,
    })),
    available: candidates.filter((repository) => {
      if (seen.has(repository.id)) return false;
      seen.add(repository.id);
      return true;
    }).map((repository) => ({
      repositoryId: repository.id,
      fullName: repository.fullName,
      installationId: repository.installationId,
      isPrivate: repository.isPrivate,
      onOtherBoard: reservations.some((row) => row.repositoryId === repository.id || row.fullName === repository.fullName),
    })),
    githubUnavailable,
  };
}

export async function getBoardGithubSettings(userId: number, projectId: number, deps: Dependencies = {}) {
  const db = deps.prisma ?? prisma;
  const admin = await requireBoardAdmin(userId, projectId, db);
  return readBoardSettings(userId, projectId, admin.teamId, db, deps.fetcher ?? fetch);
}

function parseSelection(body: unknown): { repositoryIds: string[]; version: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BoardGithubSettingsError(400, "invalid");
  const { repositoryIds, version } = body as Record<string, unknown>;
  if (
    !Array.isArray(repositoryIds) || repositoryIds.length > 50 ||
    repositoryIds.some((id) => typeof id !== "string" || !/^[1-9][0-9]{0,19}$/.test(id)) ||
    new Set(repositoryIds).size !== repositoryIds.length ||
    typeof version !== "string" || version.length === 0 || version.length > 256
  ) {
    throw new BoardGithubSettingsError(400, "invalid");
  }
  return { repositoryIds: repositoryIds as string[], version };
}

export async function saveBoardGithubRepositories(
  userId: number,
  projectId: number,
  body: unknown,
  deps: Dependencies = {},
) {
  const db = deps.prisma ?? prisma;
  const fetcher = deps.fetcher ?? fetch;
  const admin = await requireBoardAdmin(userId, projectId, db);
  const selection = parseSelection(body);
  const rows = await db.boardGithubRepository.findMany({ where: { projectId } });
  if (repositoryVersion(rows) !== selection.version) throw new BoardGithubSettingsError(409, "stale");
  const current = rows.filter((row) => row.provenance === "installed" && row.revokedAt === null);
  const addedIds = selection.repositoryIds.filter((id) => !current.some((row) => row.repositoryId === id));
  let additions: LiveRepository[] = [];
  if (addedIds.length > 0) {
    const installations = await db.githubInstallation.findMany({
      where: { teamId: admin.teamId, revokedAt: null, installedByUserId: userId },
    });
    if (installations.length === 0) throw new BoardGithubSettingsError(403, "not_installer");
    let live: LiveRepository[];
    try {
      live = await liveRepositories(installations, fetcher);
    } catch {
      throw new BoardGithubSettingsError(503, "github_unavailable");
    }
    const missing = addedIds.filter((id) => !live.some((repository) => repository.id === id && !repository.isFork));
    if (missing.length > 0) throw new BoardGithubSettingsError(403, "repo_not_installed", missing);
    additions = addedIds.map((id) => live.find((repository) => repository.id === id && !repository.isFork)!);
    const legacyConflicts = additions.filter((repository) => rows.some((row) =>
      row.revokedAt === null && row.provenance === "legacy" && row.fullName === repository.fullName,
    )).map((repository) => repository.id);
    if (legacyConflicts.length > 0) throw new BoardGithubSettingsError(409, "already_connected", legacyConflicts);
  }
  try {
    await db.$transaction(async (tx) => {
      const authorized = await requireBoardAdmin(userId, projectId, tx);
      if (authorized.teamId !== admin.teamId) throw new BoardGithubSettingsError(403, "board_access_denied");
      const latest = await tx.boardGithubRepository.findMany({ where: { projectId } });
      if (repositoryVersion(latest) !== selection.version) throw new BoardGithubSettingsError(409, "stale");
      if (additions.length > 0) {
        const installations = await tx.githubInstallation.findMany({
          where: { teamId: authorized.teamId, revokedAt: null, installedByUserId: userId },
        });
        if (installations.length === 0) throw new BoardGithubSettingsError(403, "not_installer");
        const missing = additions.filter((repository) => !installations.some((installation) =>
          installation.id === repository.installationId,
        )).map((repository) => repository.id);
        if (missing.length > 0) throw new BoardGithubSettingsError(403, "repo_not_installed", missing);
        const reservations = await tx.boardGithubRepository.findMany({
          where: {
            revokedAt: null,
            projectId: { not: projectId },
            OR: [
              { repositoryId: { in: addedIds } },
              { fullName: { in: additions.map((repository) => repository.fullName) } },
            ],
          },
        });
        const conflicts = additions.filter((repository) => reservations.some((row) =>
          row.repositoryId === repository.id || row.fullName === repository.fullName,
        )).map((repository) => repository.id);
        if (conflicts.length > 0) throw new BoardGithubSettingsError(409, "repo_on_other_board", conflicts);
      }
      await tx.boardGithubRepository.updateMany({
        where: { projectId, provenance: "installed", revokedAt: null, repositoryId: { notIn: selection.repositoryIds } },
        data: { revokedAt: new Date() },
      });
      for (const repository of additions) {
        await tx.boardGithubRepository.create({
          data: {
            projectId,
            repositoryId: repository.id,
            fullName: repository.fullName,
            installationId: repository.installationId,
            provenance: "installed",
          },
        });
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof BoardGithubSettingsError) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "P2034") throw new BoardGithubSettingsError(409, "stale");
    if (code === "P2002") throw new BoardGithubSettingsError(409, "repo_on_other_board", addedIds);
    throw error;
  }
  return getBoardGithubSettings(userId, projectId, deps);
}
