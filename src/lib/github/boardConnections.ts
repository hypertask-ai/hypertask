export interface BoardGithubRepositoryMapping {
  projectId: number;
  fullName: string;
  provenance: "legacy" | "installed";
  installationId: string | null;
  revokedAt: Date | null;
}

export function resolveLegacyBoardGithubRepository(
  repository: {
    fullName?: unknown;
    isPrivate?: unknown;
    isFork?: unknown;
  },
  mappings: readonly BoardGithubRepositoryMapping[],
): BoardGithubRepositoryMapping | null {
  if (
    typeof repository.fullName !== "string" ||
    repository.isPrivate !== false ||
    repository.isFork !== false
  ) {
    return null;
  }

  const fullName = repository.fullName.toLowerCase();
  const matches = mappings.filter(
    (mapping) => mapping.fullName === fullName && mapping.revokedAt === null,
  );
  if (matches.length !== 1) return null;

  const mapping = matches[0];
  return mapping.projectId === 15 &&
    mapping.provenance === "legacy" &&
    mapping.installationId === null
    ? mapping
    : null;
}
