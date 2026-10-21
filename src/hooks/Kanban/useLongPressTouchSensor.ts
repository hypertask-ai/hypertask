import { useContext, useLayoutEffect, useRef } from "react";
import type {
  FluidDragActions,
  PreDragActions,
  Sensor,
} from "@hello-pangea/dnd";
import {
  decidePhoneCardGesture,
  getMobileDragDelay,
  MOBILE_TASK_DRAG_TOLERANCE_PX,
} from "./mobileBoardGestures";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useKanbanBulkSelection } from "@/lib/contexts/Kanban/BulkSelectionContext";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7263_PHONE_HOLD_SELECT_FLAG } from "@/lib/flags/definitions/htpr-7263-phone-hold-select";

type Point = { x: number; y: number };
type PhoneSelection = { taskId: number; startedAt: number; movedPx: number };
type Phase =
  | { type: "idle" }
  | {
      type: "pending";
      actions: PreDragActions;
      point: Point;
      timer: ReturnType<typeof setTimeout>;
      selection?: PhoneSelection;
    }
  | {
      type: "holding";
      actions: PreDragActions;
      point: Point;
      selection: PhoneSelection;
    }
  | { type: "dragging"; actions: FluidDragActions; hasMoved: boolean };

const idle: Phase = { type: "idle" };
const listenerOptions = { capture: true, passive: false } as const;

export const useLongPressTouchSensor: Sensor = (api) => {
  const phaseRef = useRef<Phase>(idle);
  const isMobile = useContext(MobileViewContext);
  const enabled = useFlag(HTPR_7263_PHONE_HOLD_SELECT_FLAG);
  const phoneHoldSelect = enabled && isMobile;
  const { selectedCount, toggleTaskSelection } = useKanbanBulkSelection();
  const selectionRef = useRef({ selectedCount, toggleTaskSelection });
  selectionRef.current = { selectedCount, toggleTaskSelection };

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
      const taskId = phoneHoldSelect && /^task-\d+$/.test(draggableId)
        ? Number(draggableId.slice(5))
        : null;
      const selection = taskId === null
        ? undefined
        : { taskId, startedAt: Date.now(), movedPx: 0 };
      const timer = setTimeout(() => {
        const phase = phaseRef.current;
        if (phase.type !== "pending") return;
        if (phase.selection) {
          phaseRef.current = {
            type: "holding",
            actions: phase.actions,
            point: phase.point,
            selection: phase.selection,
          };
          return;
        }
        phaseRef.current = {
          type: "dragging",
          actions: phase.actions.fluidLift(phase.point),
          hasMoved: false,
        };
      }, getMobileDragDelay(draggableId));
      phaseRef.current = { type: "pending", actions, point, timer, selection };
      listenForDrag();
    };

    const onAdditionalTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) finish("cancel");
    };

    const onTouchMove = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (phase.type === "idle") return;
      if (
        event.touches.length === 1 &&
        (phase.type === "pending" || phase.type === "holding") &&
        phase.selection
      ) {
        const touch = event.touches[0];
        phase.selection.movedPx = Math.max(
          phase.selection.movedPx,
          Math.hypot(touch.clientX - phase.point.x, touch.clientY - phase.point.y),
        );
        if (phase.selection.movedPx <= MOBILE_TASK_DRAG_TOLERANCE_PX) {
          if (phase.type === "holding") event.preventDefault();
          return;
        }
        if (phase.type === "holding") {
          event.preventDefault();
          const actions = phase.actions.fluidLift(phase.point);
          phaseRef.current = { type: "dragging", actions, hasMoved: true };
          actions.move({ x: touch.clientX, y: touch.clientY });
          return;
        }
      }
      if (event.touches.length !== 1 || phase.type === "pending" || phase.type === "holding") {
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
      if ((phase.type === "pending" || phase.type === "holding") && phase.selection) {
        const { taskId, startedAt } = phase.selection;
        const touch = event.changedTouches[0];
        const movedPx = Math.max(
          phase.selection.movedPx,
          touch ? Math.hypot(touch.clientX - phase.point.x, touch.clientY - phase.point.y) : 0,
        );
        const decision = decidePhoneCardGesture(
          Date.now() - startedAt,
          movedPx,
          selectionRef.current.selectedCount > 0,
        );
        if (decision !== "open") event.preventDefault();
        finish("cancel");
        if (decision === "select" || decision === "toggle") {
          selectionRef.current.toggleTaskSelection(taskId);
        }
      } else if (phase.type === "dragging") {
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
      if (phase.type === "pending" || phase.type === "holding") {
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
      } else if (phase.type === "holding") {
        phase.actions.abort();
      } else {
        phase.actions[kind]({ shouldBlockNextClick: true });
      }
      if (relisten) listenForStart();
    }

    listenForStart();
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
      } else if (phase.type === "holding") {
        phase.actions.abort();
      } else if (phase.type === "dragging") {
        phase.actions.cancel({ shouldBlockNextClick: true });
      }
    };
  }, [api, phoneHoldSelect]);
};
