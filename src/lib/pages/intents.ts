export type PagesIntent = "link" | "new";

export const PAGES_INTENT_EVENTS: Record<PagesIntent, string> = {
  link: "pages-link-page",
  new: "pages-new-page",
};

const held = new Map<PagesIntent, string>();

export const taskSurface = ({
  projectId,
  uniqueIndex,
}: {
  projectId: number;
  uniqueIndex: number;
}) => `project-${projectId}/${uniqueIndex}`;

export const ticketSurface = (pathname: string | null) => {
  const match = pathname?.match(/^\/detail\/project-(\d+)\/(\d+)/);
  if (!match) return null;
  return taskSurface({
    projectId: Number(match[1]),
    uniqueIndex: Number(match[2]),
  });
};

export const holdPagesIntent = (intent: PagesIntent, surface: string) => {
  held.set(intent, surface);
};

export const requestPagesIntent = (
  intent: PagesIntent,
  surface: string | null
) => {
  if (!surface) return false;
  holdPagesIntent(intent, surface);
  window.dispatchEvent(new Event(PAGES_INTENT_EVENTS[intent]));
  return true;
};

export const forgetPagesIntent = (intent: PagesIntent) => {
  held.delete(intent);
};

export const claimPagesIntent = (
  intent: PagesIntent,
  surface: string | null
) => {
  if (!surface) return false;
  if (held.get(intent) !== surface) {
    held.delete(intent);
    return false;
  }
  held.delete(intent);
  return true;
};
