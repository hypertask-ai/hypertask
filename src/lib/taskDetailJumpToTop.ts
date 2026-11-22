export const TICKET_JUMP_TO_TOP_AFTER_PX = 200;

export const TICKET_JUMP_TO_TOP_KEYS = ["G", null, "G"] as const;

export function ticketShowsJumpToTop(scrollOffset: number) {
  return scrollOffset > TICKET_JUMP_TO_TOP_AFTER_PX;
}

export function scrollTicketToTop(target: { scrollTo: (options: ScrollToOptions) => void }) {
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

export function addTicketJumpToTopShortcut<T extends { title: string; sub: { shortTitle: string; pressKey: (string | null)[] }[] }>(groups: T[]) {
  const taskView = groups.find((group) => group.title === "Task View");
  if (!taskView) return;
  taskView.sub.push({ shortTitle: "Jump to top", pressKey: [...TICKET_JUMP_TO_TOP_KEYS] });
}
