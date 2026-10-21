import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6998_BOARD_SCROLL_RESTORE_FLAG } from "@/lib/flags/keys";

export const useBoardScrollRestore = (isMobile: boolean, ready: boolean) => {
  const enabled = useFlag(HTPR_6998_BOARD_SCROLL_RESTORE_FLAG);
  const pathname = usePathname();
  const query = useSearchParams()?.toString() ?? "";

  useEffect(() => {
    if (!enabled || !ready) return;
    const board = document.getElementById("sectionsContainer");
    const strip = board?.closest<HTMLElement>(".homepage-container-tag");
    if (!board || !strip) return;
    const storageKey = `htpr-6998-board-scroll:${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
    const getScrollers = () => {
      const scrollers = new Map<string, { element: HTMLElement; axis: "scrollTop" | "scrollLeft" }>([
        ["strip", { element: strip, axis: "scrollLeft" }],
        ["board", { element: board, axis: "scrollLeft" }],
      ]);
      const page = document.scrollingElement as HTMLElement | null;
      if (page) scrollers.set("page", { element: page, axis: "scrollLeft" });
      board.querySelectorAll<HTMLElement>("[id^='droppable-section-container-']").forEach(column => {
        const element = isMobile ? column.querySelector<HTMLElement>("[id^='tasks-list-']") : column;
        if (element) scrollers.set(column.id, { element, axis: "scrollTop" });
      });
      return scrollers;
    };
    let saved: Record<string, number> = {};
    try {
      const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}");
      if (value && typeof value === "object") saved = value;
    } catch {}
    const targets = new Map(Object.entries(saved).filter(([, position]) => Number.isFinite(position) && position >= 0));
    const pending = new Map(targets);
    const applied = new WeakMap<HTMLElement, number>();
    let protectFocus = pending.size > 0;
    let frame: number | null = null;
    let mutations: MutationObserver | undefined;
    let sizes: ResizeObserver | undefined;
    const stopRestore = () => {
      pending.clear();
      mutations?.disconnect();
      sizes?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };
    const save = () => {
      if (pending.size) return;
      const positions = Object.fromEntries([...getScrollers()].map(([key, { element, axis }]) => [key, element[axis]]));
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(positions));
      } catch {}
    };
    const restore = () => {
      frame = null;
      for (const [key, { element, axis }] of getScrollers()) {
        const position = pending.get(key);
        if (position === undefined) continue;
        if (axis === "scrollTop" && element.closest("[data-board-scroll-ready='false']")) continue;
        element[axis] = position;
        applied.set(element, element[axis]);
        if (Math.abs(element[axis] - position) < 1) pending.delete(key);
      }
      if (!pending.size) stopRestore();
      else {
        sizes?.observe(board);
        board.querySelectorAll<HTMLElement>("[id^='tasks-list-'], [id^='tasks-list-'] > *").forEach(element => sizes?.observe(element));
      }
    };
    const scheduleRestore = () => {
      if (pending.size && frame === null) frame = window.requestAnimationFrame(restore);
    };
    const onScroll = (event: Event) => {
      const entry = [...getScrollers()].find(([, { element }]) => element === event.target || (element === document.scrollingElement && event.target === document));
      if (!entry) return;
      const [key, scroller] = entry;
      const target = targets.get(key);
      if (protectFocus && !pending.has(key) && target !== undefined && Math.abs(scroller.element[scroller.axis] - target) >= 1) {
        pending.set(key, target);
        applied.delete(scroller.element);
        scheduleRestore();
        return;
      }
      if (pending.size && (!applied.has(scroller.element) || applied.get(scroller.element) === scroller.element[scroller.axis])) return;
      stopRestore();
      save();
    };
    const onFocus = (event: FocusEvent) => {
      if (!protectFocus || !(event.target instanceof HTMLElement)) return;
      for (const [key, { element }] of getScrollers()) {
        const position = targets.get(key);
        if (position === undefined || !element.contains(event.target)) continue;
        pending.set(key, position);
        applied.delete(element);
      }
      scheduleRestore();
    };
    const onInteract = () => {
      protectFocus = false;
      stopRestore();
    };
    strip.addEventListener("focusin", onFocus);
    strip.addEventListener("wheel", onInteract, { passive: true });
    strip.addEventListener("touchmove", onInteract, { passive: true });
    strip.addEventListener("pointerdown", onInteract, { passive: true });
    strip.addEventListener("keydown", onInteract);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("pagehide", save);
    const giveUp = window.setTimeout(onInteract, 5000);
    if (pending.size) {
      mutations = new MutationObserver(scheduleRestore);
      mutations.observe(board, { childList: true, subtree: true, attributes: true });
      if (typeof ResizeObserver !== "undefined") sizes = new ResizeObserver(scheduleRestore);
      scheduleRestore();
    }
    return () => {
      window.clearTimeout(giveUp);
      stopRestore();
      strip.removeEventListener("focusin", onFocus);
      strip.removeEventListener("wheel", onInteract);
      strip.removeEventListener("touchmove", onInteract);
      strip.removeEventListener("pointerdown", onInteract);
      strip.removeEventListener("keydown", onInteract);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", save);
    };
  }, [enabled, isMobile, pathname, query, ready]);
};
