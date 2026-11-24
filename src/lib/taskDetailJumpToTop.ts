export const TICKET_JUMP_TO_TOP_AFTER_PX = 200;

export function ticketShowsJumpToTop(scrollOffset: number) {
  return scrollOffset > TICKET_JUMP_TO_TOP_AFTER_PX;
}

export function scrollTicketToTop(target: { scrollTo: (options: ScrollToOptions) => void }) {
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}
