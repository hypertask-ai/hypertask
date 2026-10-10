import { useEffect, useRef } from "react";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7090_COMMENT_LINK_SCROLL_FLAG } from "@/lib/flags/keys";
import type { TaskDetailKeyboardContext } from "./TaskDetailKeyboardContext";

// HTPR-7090: on a fresh page load the comments arrive after the one-shot mount
// scroll in useTaskDetailInitialScroll has already run with an empty list, so it
// falls back to the composer and never reaches the linked comment. Scroll again
// once the comments are in, and re-assert while the rows measure in.
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
    // The virtualizer aims from estimated row heights, so on a cold load it can
    // stop just short of the row. Once the row is rendered, centre it for real.
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
