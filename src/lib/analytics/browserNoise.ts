import type { CaptureResult } from "posthog-js";

import { isChunkLoadError } from "@/utils/helperFunctions/isChunkLoadError";

const RESIZE_OBSERVER_LOOP_MESSAGE =
  "ResizeObserver loop completed with undelivered notifications.";

type ExceptionEntry = { type?: unknown; value?: unknown };

export const isResizeObserverLoopMessage = (message: unknown): boolean =>
  message === RESIZE_OBSERVER_LOOP_MESSAGE;

export const dropResizeObserverLoopException = (
  event: CaptureResult | null,
): CaptureResult | null => {
  if (!event || event.event !== "$exception") return event;
  const exceptions = event.properties?.$exception_list as
    | ExceptionEntry[]
    | undefined;
  if (
    Array.isArray(exceptions) &&
    exceptions.length > 0 &&
    exceptions.every((entry) => isResizeObserverLoopMessage(entry?.value))
  ) {
    return null;
  }
  return event;
};

export const dropSelfRecoveringChunkLoadException = (
  event: CaptureResult | null,
): CaptureResult | null => {
  if (!event || event.event !== "$exception") return event;
  const exceptions = event.properties?.$exception_list as
    | ExceptionEntry[]
    | undefined;
  if (
    Array.isArray(exceptions) &&
    exceptions.length > 0 &&
    exceptions.every((entry) =>
      isChunkLoadError({ name: entry?.type, message: entry?.value }),
    )
  ) {
    return null;
  }
  return event;
};
