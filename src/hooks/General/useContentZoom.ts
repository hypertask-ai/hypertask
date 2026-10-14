import { useCallback, useEffect, useRef, useState } from "react";


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
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    mode: "pending" | "custom" | "native";
  } | null>(null);

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
    }
  }, [clamp, storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(zoom));
    } catch {
    }
  }, [storageKey, zoom]);

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

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const distance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchRef.current = {
          startDist: distance(event.touches),
          startZoom: zoomRef.current,
          mode: "pending",
        };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (event.touches.length !== 2 || !pinch) return;
      const ratio = distance(event.touches) / pinch.startDist;
      if (pinch.mode === "pending") {
        const nativeScale = window.visualViewport?.scale ?? 1;
        if (ratio === 1) return;
        pinch.mode =
          nativeScale <= 1.01 && (ratio < 1 || pinch.startZoom < 1)
            ? "custom"
            : "native";
      }
      if (pinch.mode === "native") return;
      event.preventDefault();
      applyZoom(Math.min(1, pinch.startZoom * ratio));
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyZoom, targetRef]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );

  return { zoom, zoomIn, zoomOut, reset, showIndicator };
}
