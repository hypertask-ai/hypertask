import type { MouseEvent } from "react";

// Shared with AI Chat's MessageItem.tsx, which had its own copies of both
// pieces below before Agent Chat needed the same rendered-reply behavior
// (scrollable tables, internal-link/task-mention click interception) for its
// own markdown-rendered bubbles (HTPR-6038).

export const TABLE_SCROLL_WRAPPER_CLASS = "message-table-scroll";

/**
 * Wrap each top-level <table>…</table> in a scroll container in the HTML string.
 * Must run here (not via useLayoutEffect DOM hacks): React reapplies dangerouslySetInnerHTML
 * on every render, which wipes any nodes added after commit.
 */
export function wrapTablesInMessageHtml(html: string): string {
  if (!html) return html;
  const lower = html.toLowerCase();
  if (lower.indexOf("<table") === -1) return html;
  if (html.includes(`class="${TABLE_SCROLL_WRAPPER_CLASS}"`)) return html;

  let out = "";
  let i = 0;

  while (i < html.length) {
    const idx = lower.indexOf("<table", i);
    if (idx === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, idx);

    let pos = html.indexOf(">", idx) + 1;
    if (pos <= idx) pos = idx + 6;

    let depth = 1;
    let end = -1;

    while (depth > 0 && pos < html.length) {
      const nextOpen = lower.indexOf("<table", pos);
      const nextClose = lower.indexOf("</table>", pos);

      if (nextClose === -1) {
        end = -1;
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        const afterOpen = html.indexOf(">", nextOpen) + 1;
        pos = afterOpen > nextOpen ? afterOpen : nextOpen + 6;
      } else {
        depth -= 1;
        if (depth === 0) {
          end = nextClose + "</table>".length;
          break;
        }
        pos = nextClose + "</table>".length;
      }
    }

    if (end === -1) {
      out += html.slice(idx);
      break;
    }

    out += `<div class="${TABLE_SCROLL_WRAPPER_CLASS}">${html.slice(idx, end)}</div>`;
    i = end;
  }

  return out;
}

type TRouterLike = { push: (href: string) => void };

/**
 * Click handler for a rendered message bubble: intercepts internal links and
 * task-mention spans so they navigate client-side (router.push) instead of a
 * full page load, and leaves everything else (external links, mailto/tel,
 * plain text) to the browser's default handling. `onNavigate` is an optional
 * hook for a caller-specific "something is about to open" side effect (AI
 * Chat's MessageItem.tsx dismisses its mobile chat sheet there).
 */
export function interceptMessageLinkClick(
  event: MouseEvent<HTMLElement>,
  router: TRouterLike,
  onNavigate?: () => void,
): void {
  const target = event.target as HTMLElement;
  if (target && target.tagName === "A") {
    const href = target.getAttribute("href");
    if (href) {
      event.preventDefault();
      // router.push expects a relative path for client-side navigation.
      // Normalize same-origin absolute URLs to relative paths and block
      // script/data-style schemes before falling back to browser navigation.
      try {
        const url = new URL(href, window.location.origin);
        const isHttpNavigation =
          url.protocol === "http:" || url.protocol === "https:";
        const isBrowserNavigationScheme =
          isHttpNavigation ||
          url.protocol === "mailto:" ||
          url.protocol === "tel:";
        const isInternalHypertaskLink =
          url.origin === window.location.origin ||
          url.hostname === "app.hypertask.ai";

        if (!isBrowserNavigationScheme) {
          return;
        }

        if (isHttpNavigation && isInternalHypertaskLink) {
          router.push(`${url.pathname}${url.search}${url.hash}`);
          onNavigate?.();
        } else {
          window.location.href = url.href;
        }
      } catch {
        return;
      }
    }
    return;
  }
  if (
    target &&
    target.tagName === "SPAN" &&
    target.getAttribute("data-type") === "mention" &&
    target.getAttribute("data-label") === "task"
  ) {
    const path = `/detail/project-${target.getAttribute(
      "projectId",
    )}/${target.getAttribute("uniqueIndex")}`;
    event.preventDefault();
    router.push(path);
    onNavigate?.();
  }
}
