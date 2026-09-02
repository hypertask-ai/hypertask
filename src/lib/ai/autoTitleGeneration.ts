export const AUTO_TITLE_GENERATION_DELAY_MS = 5_000;

type TimerHandle = ReturnType<typeof setTimeout>;

type AutoTitleGenerationRun = {
  generate: (signal: AbortSignal) => Promise<string>;
  apply?: (title: string) => void;
  onError?: (error: unknown) => void;
};

type AutoTitleGenerationOptions = {
  initialTitle?: string;
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

type TitleOwnership = "empty" | "manual" | "generated";

export function createAutoTitleGenerationCoordinator(
  options: AutoTitleGenerationOptions = {},
) {
  const delayMs = options.delayMs ?? AUTO_TITLE_GENERATION_DELAY_MS;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const hasInitialTitle = Boolean(options.initialTitle?.trim());

  let enabled = !hasInitialTitle;
  let ownership: TitleOwnership = hasInitialTitle ? "manual" : "empty";
  let descriptionDirty = false;
  let revision = 0;
  let timer: TimerHandle | null = null;
  let request: AbortController | null = null;

  const cancelWork = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    request?.abort();
    request = null;
  };

  const invalidate = () => {
    revision += 1;
    cancelWork();
    return revision;
  };

  const runGeneration = async (
    generationRevision: number,
    run: AutoTitleGenerationRun,
  ): Promise<string | null> => {
    const controller = new AbortController();
    request = controller;

    try {
      const title = (await run.generate(controller.signal)).trim();
      if (
        !title ||
        controller.signal.aborted ||
        generationRevision !== revision ||
        !enabled
      ) {
        return null;
      }

      ownership = "generated";
      descriptionDirty = false;
      run.apply?.(title);
      return title;
    } catch (error) {
      if (controller.signal.aborted || generationRevision !== revision) {
        return null;
      }
      run.onError?.(error);
      throw error;
    } finally {
      if (request === controller) request = null;
    }
  };

  return {
    schedule(description: string, run: AutoTitleGenerationRun) {
      const generationRevision = invalidate();
      descriptionDirty = enabled;
      if (!enabled || !description.trim()) return;

      timer = setTimer(() => {
        timer = null;
        void runGeneration(generationRevision, run).catch(() => undefined);
      }, delayMs);
    },

    async generateNow(description: string, run: AutoTitleGenerationRun) {
      const generationRevision = invalidate();
      if (!enabled || !description.trim()) return null;
      return runGeneration(generationRevision, run);
    },

    manualTitleChanged(title: string) {
      invalidate();
      const hasTitle = Boolean(title.trim());
      enabled = !hasTitle;
      ownership = hasTitle ? "manual" : "empty";
      descriptionDirty = false;
    },

    taskWriterTitleApplied() {
      invalidate();
      enabled = true;
      ownership = "generated";
      descriptionDirty = false;
    },

    enableFromTaskWriter() {
      invalidate();
      enabled = true;
    },

    needsGenerationForSave(title: string, description: string) {
      return (
        enabled &&
        Boolean(description.trim()) &&
        (!title.trim() || descriptionDirty)
      );
    },

    isEnabled() {
      return enabled;
    },

    boardChanged() {
      const clearTitle = ownership === "generated";
      invalidate();
      descriptionDirty = false;
      if (clearTitle) ownership = "empty";
      return clearTitle;
    },

    reset(initialTitle = "") {
      invalidate();
      const hasTitle = Boolean(initialTitle.trim());
      enabled = !hasTitle;
      ownership = hasTitle ? "manual" : "empty";
      descriptionDirty = false;
    },

    cancelPending() {
      invalidate();
    },
  };
}

export type AutoTitleGenerationCoordinator = ReturnType<
  typeof createAutoTitleGenerationCoordinator
>;
