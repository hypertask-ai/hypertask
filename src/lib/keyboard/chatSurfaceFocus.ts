const CHAT_SURFACE_SELECTOR = [
  ".chatwindow",
  ".bg-ai-chat",
  "[data-ai-chat-panel]",
  "[data-ai-chat-surface]",
  "[data-ai-chat-composer-root]",
  "[data-agent-chat-ai-composer]",
  "#ai-chat-tiptap-editor",
  "#agent-chat-composer-editor",
].join(", ");

const CHAT_HEADER_ID_PREFIXES = ["ai-chat-header-", "ai-chat-message-"];

export function isChatSurfaceElement(
  element: Element | null | undefined
): boolean {
  if (!element) return false;
  if (CHAT_HEADER_ID_PREFIXES.some((prefix) => element.id?.startsWith(prefix)))
    return true;
  return Boolean(element.closest?.(CHAT_SURFACE_SELECTOR));
}

export function isChatSurfaceTarget(
  target: EventTarget | null | undefined
): boolean {
  if (typeof document === "undefined") return false;
  const element = target as Element | null | undefined;
  return (
    isChatSurfaceElement(element?.closest ? element : null) ||
    isChatSurfaceElement(document.activeElement)
  );
}

export function isAIChatElementFocused(): boolean {
  if (typeof document === "undefined") return false;
  return isChatSurfaceElement(document.activeElement);
}

const CHAT_SURFACE_COMPOSER_SELECTOR =
  "[data-ai-chat-surface] .ProseMirror[contenteditable='true'], [data-ai-chat-surface] textarea";

const FOCUS_FRAME_BUDGET = 90;

export function visibleChatComposer(previousSurface?: Element | null): HTMLElement | null {
  const composer = Array.from(
    document.querySelectorAll<HTMLElement>(CHAT_SURFACE_COMPOSER_SELECTOR)
  ).find(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest("[inert]") &&
      !previousSurface?.contains(element)
  );
  return composer ?? null;
}

export function focusChatComposer(previousSurface?: Element | null): boolean {
  const composer = visibleChatComposer(previousSurface);
  if (!composer) return false;
  composer.focus({ preventScroll: true });
  return document.activeElement === composer;
}

export function focusChatComposerAcrossSurfaces(
  previousSurface?: Element | null,
  frameBudget = FOCUS_FRAME_BUDGET
): void {
  if (typeof window === "undefined") return;
  let frames = 0;
  let settled = 0;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  window.addEventListener("pointerdown", cancel, true);
  window.addEventListener("keydown", cancel, true);
  const stop = () => {
    window.removeEventListener("pointerdown", cancel, true);
    window.removeEventListener("keydown", cancel, true);
  };
  const step = () => {
    if (cancelled) return stop();
    settled = focusChatComposer(previousSurface) ? settled + 1 : 0;
    if (settled >= 2) return stop();
    frames += 1;
    if (frames >= frameBudget) return stop();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
