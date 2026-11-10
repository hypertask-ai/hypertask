export interface BoardGithubRepositoryMapping {
  projectId: number;
  fullName: string;
  repositoryId: string | null;
  provenance: "legacy" | "installed";
  installationId: string | null;
  revokedAt: Date | null;
}

export function githubRepositoryId(value: unknown): string | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+$/.test(String(value))
  ) {
    return null;
  }
  return String(value);
}

function mappingMatchesRepository(
  repository: {
    fullName?: unknown;
    id?: unknown;
  },
  mapping: BoardGithubRepositoryMapping,
): boolean {
  if (mapping.revokedAt !== null) return false;

  if (mapping.provenance === "legacy") {
    if (typeof repository.fullName !== "string") return false;
    return mapping.fullName === repository.fullName.toLowerCase();
  }

  const repositoryId = githubRepositoryId(repository.id);
  if (
    repositoryId === null ||
    mapping.repositoryId === null ||
    mapping.repositoryId !== repositoryId
  ) {
    return false;
  }
  if (typeof repository.fullName !== "string") return false;
  return mapping.fullName === repository.fullName.toLowerCase();
}

export function resolveBoardGithubRepository(
  repository: {
    fullName?: unknown;
    id?: unknown;
    isPrivate?: unknown;
    isFork?: unknown;
  },
  mappings: readonly BoardGithubRepositoryMapping[],
): number | null {
  const matches = mappings.filter((mapping) =>
    mappingMatchesRepository(repository, mapping),
  );
  if (matches.length !== 1) return null;

  const mapping = matches[0];
  if (repository.isFork !== false) return null;

  if (mapping.provenance === "legacy") {
    if (repository.isPrivate !== false) return null;
    return mapping.projectId === 15 && mapping.installationId === null
      ? mapping.projectId
      : null;
  }

  return mapping.installationId === null ? null : mapping.projectId;
}
