import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const useAutosizeTextArea = (
  textArea: HTMLTextAreaElement | RefObject<HTMLTextAreaElement | null> | null,
  value: string,
  taskWriterDetails?: {
    editMode: ITaskDetailEditMode | undefined;
    createTask: boolean | undefined;
    isMobile: boolean;
    maxHeightPx?: number;
  },
  resizeTrigger?: unknown
) => {
  const recalc = () => {
    const textAreaRef = textArea && "current" in textArea ? textArea.current : textArea;
    if (!textAreaRef) return;
    textAreaRef.style.height = taskWriterDetails
      ? aiTaskWriterConfig.fontSizes.placeholder
      : "37px";
    const scrollHeight = textAreaRef.scrollHeight;

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

  useLayoutEffect(() => {
    recalcRef.current();
  }, [textArea, value, resizeTrigger]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => recalcRef.current());
    return () => cancelAnimationFrame(raf);
  }, [resizeTrigger]);

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
    const parentEl =
      (textAreaRef.closest("popover-wrapper-description") as HTMLElement) ||
      textAreaRef.parentElement;
    if (parentEl) {
      const parentStyles = window.getComputedStyle(parentEl);
      const parentHeight =
        parentEl.clientHeight -
        parseFloat(parentStyles.paddingTop) -
        parseFloat(parentStyles.paddingBottom);

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
