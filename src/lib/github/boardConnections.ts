export interface BoardGithubRepositoryMapping {
  projectId: number;
  fullName: string;
  provenance: "legacy" | "installed";
  installationId: string | null;
  revokedAt: Date | null;
}

export function resolveBoardGithubRepository(
  repository: {
    fullName?: unknown;
    isPrivate?: unknown;
    isFork?: unknown;
  },
  mappings: readonly BoardGithubRepositoryMapping[],
): number | null {
  if (typeof repository.fullName !== "string") return null;
  const fullName = repository.fullName.toLowerCase();
  const matches = mappings.filter(
    (mapping) => mapping.fullName === fullName && mapping.revokedAt === null,
  );
  if (matches.length !== 1) return null;

  const mapping = matches[0];
  if (repository.isFork !== false) return null;

  if (mapping.provenance === "legacy") {
    if (repository.isPrivate !== false) return null;
    if (mapping.projectId !== 15 || mapping.installationId !== null) return null;
    return mapping.projectId;
  }

  if (mapping.provenance === "installed") {
    if (mapping.installationId === null) return null;
    return mapping.projectId;
  }

  return null;
}

export function resolveLegacyBoardGithubRepository(
  repository: {
    fullName?: unknown;
    isPrivate?: unknown;
    isFork?: unknown;
  },
  mappings: readonly BoardGithubRepositoryMapping[],
): BoardGithubRepositoryMapping | null {
  if (resolveBoardGithubRepository(repository, mappings) !== 15) return null;
  const fullName =
    typeof repository.fullName === "string"
      ? repository.fullName.toLowerCase()
      : "";
  const match = mappings.find(
    (mapping) =>
      mapping.fullName === fullName &&
      mapping.revokedAt === null &&
      mapping.provenance === "legacy" &&
      mapping.projectId === 15 &&
      mapping.installationId === null,
  );
  return match ?? null;
}
