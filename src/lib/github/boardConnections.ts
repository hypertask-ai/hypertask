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
    return mapping.projectId === 15 && mapping.installationId === null
      ? mapping.projectId
      : null;
  }

  return mapping.installationId === null ? null : mapping.projectId;
}
