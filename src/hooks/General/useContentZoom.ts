import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-app zoom for a scrollable content region (e.g. the Page editor body).
 *
 * Phones use native pinch zoom (the page route re-enables it in its
 * `viewport`), which also enlarges images. This hook only adds desktop zoom.
 * It applies to the target element via CSS `zoom`, which reflows text within
 * the container width instead of overflowing (unlike `transform: scale`), and
 * keeps pointer/caret coordinates correct for the underlying editor.
 *
 * Mechanisms (no new visible chrome, no registered keyboard shortcuts):
 *  - Ctrl/⌘ + wheel — also fires for trackpad pinch (desktop)
 *
 * The chosen level is persisted so a reader's comfort setting survives reloads.
 */

type Options = {
  min?: number;
  max?: number;
  step?: number;
  storageKey?: string;
};

const DEFAULTS = {
  min: 0.6,
  max: 2,
  step: 0.1,
  storageKey: "hypertask:page-zoom",
};

export function useContentZoom(
  targetRef: React.RefObject<HTMLElement | null>,
  options: Options = {}
) {
  const { min, max, step, storageKey } = { ...DEFAULTS, ...options };

  const [zoom, setZoom] = useState(1);
  const [showIndicator, setShowIndicator] = useState(false);
  const zoomRef = useRef(1);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clamp = useCallback(
    (value: number) =>
      Math.min(max, Math.max(min, Math.round(value * 100) / 100)),
    [max, min]
  );

  const flashIndicator = useCallback(() => {
    setShowIndicator(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowIndicator(false), 900);
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      if (clamped !== zoomRef.current) {
        zoomRef.current = clamped;
        setZoom(clamped);
      }
      flashIndicator();
    },
    [clamp, flashIndicator]
  );

  const zoomIn = useCallback(
    () => applyZoom(zoomRef.current + step),
    [applyZoom, step]
  );
  const zoomOut = useCallback(
    () => applyZoom(zoomRef.current - step),
    [applyZoom, step]
  );
  const reset = useCallback(() => applyZoom(1), [applyZoom]);

  // Restore the persisted level once, on the client.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = clamp(parseFloat(raw));
      if (!Number.isNaN(parsed)) {
        zoomRef.current = parsed;
        setZoom(parsed);
      }
    } catch {
      // localStorage may be unavailable (private mode / SSR) — ignore.
    }
  }, [clamp, storageKey]);

  // Persist changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(zoom));
    } catch {
      // ignore
    }
  }, [storageKey, zoom]);

  // Ctrl/⌘ + wheel (mouse wheel + trackpad pinch, which browsers report as a
  // ctrl-modified wheel event). Scale by a clamped delta so both a coarse mouse
  // notch and a fine trackpad gesture feel natural.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const delta = Math.max(-40, Math.min(40, event.deltaY));
      applyZoom(zoomRef.current * Math.exp(-delta * 0.005));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, targetRef]);

  // Clear any pending indicator timer on unmount.
  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );

  return { zoom, zoomIn, zoomOut, reset, showIndicator };
}
