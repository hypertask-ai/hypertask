import { useEffect, useRef } from "react";
import { useRecoilState } from "@/lib/state";
import { boardZoomedOutAtom } from "@/store";
import { getPinchZoomState } from "./mobileBoardGestures";

type Pinch = {
  ids: [number, number];
  startDistance: number;
  initialZoomedOut: boolean;
  committed: boolean;
};

const listenerOptions = { capture: true, passive: false } as const;

const findTouch = (touches: TouchList, id: number) => {
  for (let index = 0; index < touches.length; index += 1) {
    if (touches[index].identifier === id) return touches[index];
  }
  return null;
};

const distanceBetween = (left: Touch, right: Touch) =>
  Math.hypot(left.clientX - right.clientX, left.clientY - right.clientY);

const isBoardTouch = (touch: Touch) => {
  if (
    touch.target instanceof Element &&
    touch.target.closest("#sectionsContainer")
  ) {
    return true;
  }

  const board = document.getElementById("sectionsContainer");
  if (!board) return false;
  const bounds = board.getBoundingClientRect();
  return (
    touch.clientX >= bounds.left &&
    touch.clientX <= bounds.right &&
    touch.clientY >= bounds.top &&
    touch.clientY <= bounds.bottom
  );
};

export const useMobileBoardZoom = (enabled: boolean) => {
  const [zoomedOut, setZoomedOut] = useRecoilState(boardZoomedOutAtom);
  const zoomedOutRef = useRef(zoomedOut);
  const pinchRef = useRef<Pinch | null>(null);
  zoomedOutRef.current = zoomedOut;

  useEffect(() => {
    if (!enabled) return;
    let listeningForPinch = false;

    const stopListeningForPinch = () => {
      if (!listeningForPinch) return;
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", reset, true);
      listeningForPinch = false;
    };
    const reset = () => {
      pinchRef.current = null;
      stopListeningForPinch();
    };
    const listenForPinch = () => {
      if (listeningForPinch) return;
      document.addEventListener("touchmove", onTouchMove, listenerOptions);
      document.addEventListener("touchend", onTouchEnd, listenerOptions);
      document.addEventListener("touchcancel", reset, listenerOptions);
      listeningForPinch = true;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        if (pinchRef.current) event.preventDefault();
        reset();
        return;
      }

      const left = event.touches[0];
      const right = event.touches[1];
      if (!isBoardTouch(left) || !isBoardTouch(right)) return;

      event.preventDefault();
      pinchRef.current = {
        ids: [left.identifier, right.identifier],
        startDistance: distanceBetween(left, right),
        initialZoomedOut: zoomedOutRef.current,
        committed: false,
      };
      listenForPinch();
    };
    function onTouchMove(event: TouchEvent) {
      const pinch = pinchRef.current;
      if (!pinch || event.touches.length !== 2) {
        reset();
        return;
      }

      const left = findTouch(event.touches, pinch.ids[0]);
      const right = findTouch(event.touches, pinch.ids[1]);
      if (!left || !right) {
        reset();
        return;
      }

      event.preventDefault();
      if (pinch.committed) return;
      const next = getPinchZoomState({
        zoomedOut: pinch.initialZoomedOut,
        startDistance: pinch.startDistance,
        currentDistance: distanceBetween(left, right),
        touchCount: event.touches.length,
      });
      if (next !== pinch.initialZoomedOut) {
        pinch.committed = true;
        zoomedOutRef.current = next;
        setZoomedOut(next);
      }
    }
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) reset();
    }

    document.addEventListener("touchstart", onTouchStart, listenerOptions);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      reset();
    };
  }, [enabled, setZoomedOut]);

  return zoomedOut;
};
