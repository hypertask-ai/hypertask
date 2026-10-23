import { useEffect, useRef } from "react";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7090_COMMENT_LINK_SCROLL_FLAG } from "@/lib/flags/keys";
import type { TaskDetailKeyboardContext } from "./TaskDetailKeyboardContext";

export const LINKED_COMMENT_SCROLL_PASSES_MS = [
  taskDetailConfig.delays.scrollToElement,
  taskDetailConfig.delays.scrollToElement + 700,
  taskDetailConfig.delays.scrollToElement + 1700,
];

export function useLinkedCommentScroll(context: TaskDetailKeyboardContext) {
  const enabled = useFlag(HTPR_7090_COMMENT_LINK_SCROLL_FLAG);
  const { comments, scrollVirtualize, searchParams, initialScrollGuard, initialScrollGenerationRef, _parsedTask } = context;
  const latestScrollVirtualize = useRef(scrollVirtualize);
  latestScrollVirtualize.current = scrollVirtualize;
  const handledKey = useRef<string | null>(null);
  const linkedComment = searchParams?.get(taskDetailConfig.searchParams.commentId);
  const hasComments = comments.length > 0;

  useEffect(() => {
    if (!enabled || !linkedComment || !hasComments) return;
    const key = `${_parsedTask.id}:${linkedComment}`;
    if (handledKey.current === key) return;
    handledKey.current = key;
    const commentId = parseInt(linkedComment.split("-")[1]);
    if (Number.isNaN(commentId)) return;
    const generation = initialScrollGenerationRef.current;
    const frames: number[] = [];
    const centerRenderedComment = () => {
      const element = document.getElementById(`comment-${commentId}-input`);
      if (!element) return;
      const { top, bottom } = element.getBoundingClientRect();
      if (top >= 0 && bottom <= window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "center" });
    };
    const timeouts = LINKED_COMMENT_SCROLL_PASSES_MS.map((delay) =>
      setTimeout(() => {
        initialScrollGuard.run(generation, () =>
          latestScrollVirtualize.current(taskDetailConfig.elementIds.comment, commentId, undefined, true)
        );
        frames.push(requestAnimationFrame(() => initialScrollGuard.run(generation, centerRenderedComment)));
      }, delay)
    );
    return () => {
      timeouts.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
    };
  }, [enabled, linkedComment, hasComments, _parsedTask.id]);
}
