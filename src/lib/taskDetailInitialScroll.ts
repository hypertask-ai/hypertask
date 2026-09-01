export function createTaskDetailInitialScrollGuard(onInterrupt: () => void) {
  let generation = 0;
  let interrupted = true;

  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    onInterrupt();
  };

  return {
    reset() {
      interrupt();
      generation += 1;
      interrupted = false;
      return generation;
    },
    invalidate(currentGeneration: number) {
      if (currentGeneration !== generation) return false;
      interrupt();
      generation += 1;
      return true;
    },
    allows(currentGeneration: number) {
      return currentGeneration === generation && !interrupted;
    },
    run(currentGeneration: number, callback: () => void) {
      if (currentGeneration !== generation || interrupted) return false;
      callback();
      return true;
    },
    listen(target: EventTarget) {
      target.addEventListener("wheel", interrupt, { passive: true });
      target.addEventListener("touchmove", interrupt, { passive: true });
      return () => {
        target.removeEventListener("wheel", interrupt);
        target.removeEventListener("touchmove", interrupt);
      };
    },
  };
}
