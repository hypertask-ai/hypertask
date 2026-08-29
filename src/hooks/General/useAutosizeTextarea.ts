import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useEffect, useRef } from "react";

// Updates the height of a <textarea> when the value changes.
const useAutosizeTextArea = (
  textAreaRef: HTMLTextAreaElement | null,
  value: string,
  taskWriterDetails?: {
    editMode: ITaskDetailEditMode | undefined;
    createTask: boolean | undefined;
    isMobile: boolean;
    maxHeightPx?: number;
  },
  // Any value that changes when the surrounding layout width changes (e.g. the
  // AI chat sidebar open state / width). Wrapped-text height depends on width,
  // so we must recompute on those shifts, not only on value change.
  resizeTrigger?: unknown
) => {
  const recalc = () => {
    if (!textAreaRef) return;
    textAreaRef.style.height = taskWriterDetails
      ? aiTaskWriterConfig.fontSizes.placeholder
      : "37px";
    const scrollHeight = textAreaRef.scrollHeight;

    // Calculate the height of the textarea based on the task writer details
    let continueCalculating = true;
    if (taskWriterDetails)
      continueCalculating = calculateAITaskWriterHeight(
        textAreaRef,
        scrollHeight,
        value,
        taskWriterDetails
      );

    if (continueCalculating) {
      textAreaRef.style.height = scrollHeight + "px";
      textAreaRef.style.overflowY = "hidden";
    }
  };
  const recalcRef = useRef(recalc);
  recalcRef.current = recalc;

  // Recalc on value change and whenever the caller signals a layout-width shift
  // (chat sidebar toggle). rAF lets the new layout settle before we measure, or
  // the height baked in at the old width goes stale and the textarea overlaps
  // the content below it (HTPR-4321). A textarea ResizeObserver does NOT fire
  // for width changes driven by an ancestor flex reflow, so we can't rely on it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => recalcRef.current());
    return () => cancelAnimationFrame(raf);
  }, [textAreaRef, value, resizeTrigger]);

  // Viewport resize (e.g. dragging the window to/from half-screen) also changes
  // the wrap width.
  useEffect(() => {
    const onResize = () => recalcRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
};

function calculateAITaskWriterHeight(
  textAreaRef: HTMLTextAreaElement,
  scrollHeight: number,
  value: string,
  taskWriterDetails: {
    editMode: ITaskDetailEditMode | undefined;
    createTask: boolean | undefined;
    isMobile: boolean;
    maxHeightPx?: number;
  }
) {
  if (!value.length) {
    textAreaRef.style.height = aiTaskWriterConfig.fontSizes.placeholder;
    return false;
  }

  const isFallbackHeight =
    taskWriterDetails?.createTask == null &&
    taskWriterDetails?.editMode == null;

  if (isFallbackHeight) {
    // Try parent popover wrapper or parent element for max height
    const parentEl =
      (textAreaRef.closest("popover-wrapper-description") as HTMLElement) ||
      textAreaRef.parentElement;
    if (parentEl) {
      const parentStyles = window.getComputedStyle(parentEl);
      const parentHeight =
        parentEl.clientHeight -
        parseFloat(parentStyles.paddingTop) -
        parseFloat(parentStyles.paddingBottom);

      // Get 60svh in pixels
      const tempDiv = document.createElement("div");
      tempDiv.style.height = "60svh";
      tempDiv.style.position = "absolute";
      tempDiv.style.visibility = "hidden";
      document.body.appendChild(tempDiv);
      const sixtySVH = tempDiv.offsetHeight;
      document.body.removeChild(tempDiv);

      if (parentHeight >= sixtySVH && scrollHeight > parentHeight) {
        textAreaRef.style.height = parentHeight + "px";
        textAreaRef.style.overflowY = "auto";
        return false;
      }
    }
  }

  // Mobile Task Writer reserves room for its keyboard-safe action dock. Other
  // callers keep the existing 60svh cap.
  let maxHeight = taskWriterDetails.maxHeightPx;
  if (maxHeight == null) {
    const tempDiv = document.createElement("div");
    tempDiv.style.height =
      aiTaskWriterConfig.tiptapDimension.createTaskModal.maxHeight;
    tempDiv.style.position = "absolute";
    tempDiv.style.visibility = "hidden";
    document.body.appendChild(tempDiv);
    maxHeight = tempDiv.offsetHeight;
    document.body.removeChild(tempDiv);
  }

  if (scrollHeight > maxHeight) {
    textAreaRef.style.height = maxHeight + "px";
    textAreaRef.style.overflowY = "auto";
    return false;
  }
  return true;
}

export default useAutosizeTextArea;
