import { useLayoutEffect, useRef } from "react";
import type {
  FluidDragActions,
  PreDragActions,
  Sensor,
} from "@hello-pangea/dnd";
import { getMobileDragDelay } from "./mobileBoardGestures";

type Point = { x: number; y: number };
type Phase =
  | { type: "idle" }
  | {
      type: "pending";
      actions: PreDragActions;
      point: Point;
      timer: ReturnType<typeof setTimeout>;
    }
  | { type: "dragging"; actions: FluidDragActions; hasMoved: boolean };

const idle: Phase = { type: "idle" };
const listenerOptions = { capture: true, passive: false } as const;

export const useLongPressTouchSensor: Sensor = (api) => {
  const phaseRef = useRef<Phase>(idle);

  useLayoutEffect(() => {
    let listeningForStart = false;
    let listeningForDrag = false;

    const onTouchStart = (event: TouchEvent) => {
      if (event.defaultPrevented || event.touches.length !== 1) return;

      const draggableId = api.findClosestDraggableId(event);
      if (!draggableId) return;
      const actions = api.tryGetLock(
        draggableId,
        () => finish("cancel"),
        { sourceEvent: event },
      );
      if (!actions) return;

      stopListeningForStart();
      const touch = event.touches[0];
      const point = { x: touch.clientX, y: touch.clientY };
      const timer = setTimeout(() => {
        const phase = phaseRef.current;
        if (phase.type !== "pending") return;
        phaseRef.current = {
          type: "dragging",
          actions: phase.actions.fluidLift(phase.point),
          hasMoved: false,
        };
      }, getMobileDragDelay(draggableId));
      phaseRef.current = { type: "pending", actions, point, timer };
      listenForDrag();
    };

    const onAdditionalTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) finish("cancel");
    };

    const onTouchMove = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (phase.type === "idle") return;
      if (event.touches.length !== 1 || phase.type === "pending") {
        finish("cancel");
        return;
      }

      event.preventDefault();
      phase.hasMoved = true;
      const touch = event.touches[0];
      phase.actions.move({ x: touch.clientX, y: touch.clientY });
    };

    const onTouchEnd = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (phase.type === "idle") return;
      if (phase.type === "dragging") {
        event.preventDefault();
        finish("drop");
      } else {
        finish("cancel");
      }
    };

    const onCancel = (event?: Event) => {
      if (phaseRef.current.type === "idle") return;
      event?.preventDefault();
      finish("cancel");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current.type === "idle") return;
      if (event.key === "Escape") event.preventDefault();
      finish("cancel");
    };
    const onContextMenu = (event: Event) => {
      if (phaseRef.current.type !== "idle") event.preventDefault();
    };
    const onTouchForceChange = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (phase.type === "idle") return;
      const touch = event.touches[0] as (Touch & { force?: number }) | undefined;
      if (!touch || (touch.force ?? 0) < 0.15) return;

      const shouldRespect = phase.actions.shouldRespectForcePress();
      if (phase.type === "pending") {
        if (shouldRespect) finish("cancel");
        return;
      }
      if (shouldRespect && !phase.hasMoved) {
        finish("cancel");
        return;
      }
      event.preventDefault();
    };

    function listenForStart() {
      if (listeningForStart) return;
      window.addEventListener("touchstart", onTouchStart, listenerOptions);
      listeningForStart = true;
    }

    function stopListeningForStart() {
      if (!listeningForStart) return;
      window.removeEventListener("touchstart", onTouchStart, true);
      listeningForStart = false;
    }

    function listenForDrag() {
      if (listeningForDrag) return;
      window.addEventListener("touchstart", onAdditionalTouchStart, listenerOptions);
      window.addEventListener("touchmove", onTouchMove, listenerOptions);
      window.addEventListener("touchend", onTouchEnd, listenerOptions);
      window.addEventListener("touchcancel", onCancel, listenerOptions);
      window.addEventListener(
        "touchforcechange",
        onTouchForceChange as EventListener,
        listenerOptions,
      );
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("contextmenu", onContextMenu, true);
      window.addEventListener("orientationchange", onCancel);
      window.addEventListener("resize", onCancel);
      document.addEventListener("visibilitychange", onCancel);
      listeningForDrag = true;
    }

    function stopListeningForDrag() {
      if (!listeningForDrag) return;
      window.removeEventListener("touchstart", onAdditionalTouchStart, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onCancel, true);
      window.removeEventListener(
        "touchforcechange",
        onTouchForceChange as EventListener,
        true,
      );
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("orientationchange", onCancel);
      window.removeEventListener("resize", onCancel);
      document.removeEventListener("visibilitychange", onCancel);
      listeningForDrag = false;
    }

    function finish(kind: "cancel" | "drop", relisten = true) {
      const phase = phaseRef.current;
      if (phase.type === "idle") return;
      phaseRef.current = idle;
      stopListeningForDrag();
      if (phase.type === "pending") {
        clearTimeout(phase.timer);
        phase.actions.abort();
      } else {
        phase.actions[kind]({ shouldBlockNextClick: true });
      }
      if (relisten) listenForStart();
    }

    listenForStart();
    // Safari needs one non-capturing listener before a later drag can cancel scrolling.
    const safariTouchMove = () => {};
    window.addEventListener("touchmove", safariTouchMove, {
      capture: false,
      passive: false,
    });

    return () => {
      stopListeningForStart();
      stopListeningForDrag();
      window.removeEventListener("touchmove", safariTouchMove, false);
      const phase = phaseRef.current;
      phaseRef.current = idle;
      if (phase.type === "pending") {
        clearTimeout(phase.timer);
        phase.actions.abort();
      } else if (phase.type === "dragging") {
        phase.actions.cancel({ shouldBlockNextClick: true });
      }
    };
  }, [api]);
};
