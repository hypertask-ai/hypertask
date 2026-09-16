export function pinCommentGroupFirst<T extends { group: string }>(
  commandGroups: T[],
): T[] {
  const comment = commandGroups.find((group) => group.group === "Comment");
  if (!comment) return commandGroups;
  return [comment, ...commandGroups.filter((group) => group !== comment)];
}
