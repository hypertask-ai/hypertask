/**
 * HTPR-6818: where a /detail URL without a ticket number (/detail/project-15)
 * should go, or null when the URL addresses a task. Prefixed IDs must reach
 * the page, where the feature flag and board access are checked.
 */
export function detailWithoutTicketRedirect(pathname: string): string | null {
  if (!pathname.startsWith("/detail/")) return null;
  const [projectSlug = "", ticketNumber = ""] = pathname.split("/").slice(2);
  const projectId = parseInt(projectSlug.split("-")[1], 10);
  if (Number.isInteger(projectId) && (
    Number.isInteger(parseInt(ticketNumber, 10)) || /^[A-Za-z0-9][A-Za-z0-9_-]*-\d+$/.test(ticketNumber)
  )) return null;
  return Number.isInteger(projectId) ? `/project?id=${projectId}` : "/";
}
