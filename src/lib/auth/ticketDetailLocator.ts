export type TicketDetailLocator = {
  projectSlug: string;
  uniqueIndex: string;
};

export function ticketDetailLocator(pathname: string): TicketDetailLocator | null {
  const match = /^\/detail\/(project-\d+)\/(\d+)\/?$/.exec(pathname);
  if (!match) return null;
  return { projectSlug: match[1], uniqueIndex: match[2] };
}

export function ticketDetailFields(
  projectSlug: unknown,
  uniqueIndex: unknown,
): TicketDetailLocator | null {
  if (typeof projectSlug !== "string" || typeof uniqueIndex !== "string") return null;
  return ticketDetailLocator(`/detail/${projectSlug}/${uniqueIndex}`);
}
