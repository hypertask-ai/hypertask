export const buildCalendarAuthorizationRevision = (
  projectIds: readonly number[],
): string => {
  const normalized = [...new Set(projectIds)]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right);
  return normalized.length === 0 ? "none" : normalized.join(".");
};
