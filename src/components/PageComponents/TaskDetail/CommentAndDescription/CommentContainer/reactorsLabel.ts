/**
 * Tooltip text for who reacted with one emoji. HTPR-7122: an agent's reaction
 * arrives with id null and a name like "Runner 5 (agent)", so it is never
 * counted as the viewer's own reaction, even when the viewer owns that agent.
 */
export function reactorsLabel(
  users: ReadonlyArray<{ id?: number | null; displayName?: string | null }> | null | undefined,
  currentUserId: number | null | undefined
): string {
  if (!users?.length) return "";

  const otherUsers: any[] = [];
  let includesCurrentUser = false;

  users.forEach((user) => {
    if (user.id != null && user.id === currentUserId) {
      includesCurrentUser = true;
    } else {
      otherUsers.push(user.displayName);
    }
  });

  let temp = "";

  if (otherUsers.length === 0) {
    temp = "You (click to remove)";
  } else if (otherUsers.length === 1) {
    temp = includesCurrentUser ? `${otherUsers[0]} and you` : otherUsers[0];
  } else {
    // Handle cases with more than 5 total users
    if (users.length > 5) {
      const displayUsers = otherUsers.slice(0, includesCurrentUser ? 4 : 5);
      const remainingCount =
        users.length -
        displayUsers.length -
        (includesCurrentUser ? 1 : 0);

      temp = includesCurrentUser
        ? `${displayUsers.join(", ")}, you and +${remainingCount}`
        : `${displayUsers.join(", ")} and +${remainingCount}`;
    } else {
      // Original logic for 5 or fewer users
      const lastUser = otherUsers.pop();
      temp = includesCurrentUser
        ? `${otherUsers.join(", ")}, ${lastUser} and you`
        : `${otherUsers.join(", ")} and ${lastUser}`;
    }
  }

  return `${temp}`;
}
