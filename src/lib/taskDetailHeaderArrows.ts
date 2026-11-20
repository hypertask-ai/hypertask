export const DETAIL_PAGE_MIN_WIDTH_PX = 944;

export function detailSidebarOverlays(viewportWidth: number, sidebarWidthPx: number, mobile: boolean): boolean {
  if (mobile || sidebarWidthPx <= 0 || viewportWidth <= 0) return false;
  return viewportWidth < Math.max(768, sidebarWidthPx + DETAIL_PAGE_MIN_WIDTH_PX);
}

export function ticketUpDownLivesInHeader(enabled: boolean, mobile: boolean, embedded: boolean, sidebarOverlays = false): boolean {
  return enabled && !mobile && !embedded && !sidebarOverlays;
}
