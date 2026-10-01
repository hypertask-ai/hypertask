import { useEffect, type DependencyList } from "react";

type TutorialKeyboardListeners = {
  target: Document | Window;
  capture?: boolean;
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  handlePointerDown?: () => void;
  onCleanup?: () => void;
};

export const useTutorialEngine = (
  setup: () => TutorialKeyboardListeners | undefined,
  dependencies: DependencyList,
) => {
  useEffect(() => {
    const listeners = setup();
    if (!listeners) return;

    const {
      target,
      capture,
      handleKeyDown,
      handleKeyUp,
      handlePointerDown,
      onCleanup,
    } = listeners;
    target.addEventListener("keydown", handleKeyDown as EventListener, capture);
    target.addEventListener("keyup", handleKeyUp as EventListener, capture);
    if (handlePointerDown) {
      target.addEventListener("pointerdown", handlePointerDown, capture);
    }
    return () => {
      onCleanup?.();
      target.removeEventListener("keydown", handleKeyDown as EventListener, capture);
      target.removeEventListener("keyup", handleKeyUp as EventListener, capture);
      if (handlePointerDown) {
        target.removeEventListener("pointerdown", handlePointerDown, capture);
      }
    };
  }, dependencies);
};
