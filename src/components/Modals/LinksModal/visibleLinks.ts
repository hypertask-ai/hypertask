import type { IUrl } from "@/models/model";

export function normalizeLink(href: string): string | undefined {
  try {
    if (!href.trim()) return undefined;
    const url = new URL(href, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function snapshotVisibleLinks(taskPath: string): Set<string> {
  const visible = new Set<string>();
  const roots = document.querySelectorAll<HTMLElement>("[data-task-detail-path]");
  for (const root of roots) {
    if (root.dataset.taskDetailPath !== taskPath) continue;
    const anchors = root.querySelectorAll<HTMLAnchorElement>('[id="description-input"] a[href], [id^="comment-"][id$="-input"]:not([id="comment-input-input"]) a[href]');
    for (const anchor of anchors) {
      const excluded = anchor.closest('nav, [role="navigation"], .modal, [role="dialog"]');
      if ((excluded && excluded !== root && root.contains(excluded)) || anchor.closest('[hidden], [aria-hidden="true"]')) continue;
      const href = normalizeLink(anchor.getAttribute("href") || "");
      if (!href) continue;
      for (const rect of anchor.getClientRects()) {
        let left = Math.max(rect.left, 0);
        let right = Math.min(rect.right, window.innerWidth);
        let top = Math.max(rect.top, 0);
        let bottom = Math.min(rect.bottom, window.innerHeight);
        for (let element: HTMLElement | null = anchor; element; element = element.parentElement) {
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || element.hidden) {
            right = left;
            break;
          }
          if (element !== anchor && /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY} ${style.overflow}`)) {
            const bounds = element.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflow}`)) {
              left = Math.max(left, bounds.left + element.clientLeft);
              right = Math.min(right, bounds.left + element.clientLeft + element.clientWidth);
            }
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflowY} ${style.overflow}`)) {
              top = Math.max(top, bounds.top + element.clientTop);
              bottom = Math.min(bottom, bounds.top + element.clientTop + element.clientHeight);
            }
          }
        }
        if (right > left && bottom > top) {
          visible.add(href);
          break;
        }
      }
    }
  }
  return visible;
}

export function prioritizeVisibleLinks(links: IUrl[], visible: Set<string>): IUrl[] {
  const first: IUrl[] = [];
  const rest: IUrl[] = [];
  for (const link of links) {
    const href = normalizeLink(link.urlString);
    (href && visible.has(href) ? first : rest).push(link);
  }
  return [...first, ...rest];
}
