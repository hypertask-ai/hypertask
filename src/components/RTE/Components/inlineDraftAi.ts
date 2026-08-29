export interface InlineDraftAiRange {
  from: number;
  to: number;
}

export function resolveInitialInlineDraftAiRange({
  from,
  to,
  docSize,
  isEmpty,
}: InlineDraftAiRange & {
  docSize: number;
  isEmpty: boolean;
}): InlineDraftAiRange {
  if (!isEmpty && from === to) return { from: 0, to: docSize };
  return { from, to };
}

export function shouldShowInlineDraftAiChips(
  hasSelection: boolean,
  prompt: string,
) {
  return hasSelection && prompt.trim().length === 0;
}

export function inlineDraftAiWritePlaceholder(
  hasSelection: boolean,
  allowSuggestReply: boolean,
  isEmpty: boolean,
) {
  if (hasSelection) return "Describe how to edit the text…";
  if (allowSuggestReply && isEmpty) {
    return "Describe what to write, or press Shift+R for a suggestion…";
  }
  return "Describe what to write…";
}

export function mergeInlineDraftAiDictation(
  current: string,
  dictated: string,
  replace: boolean,
) {
  return (replace ? dictated : current + dictated).slice(0, 2_000);
}

export function inlineDraftAiCommandForInstruction(hasSelection: boolean) {
  return hasSelection ? "CustomEdit" : "WriteContent";
}

export function rewrittenInlineDraftAiRange({
  oldDocSize,
  newDocSize,
  range,
}: {
  oldDocSize: number;
  newDocSize: number;
  range: InlineDraftAiRange;
}): InlineDraftAiRange {
  const insertedSize = newDocSize - oldDocSize + (range.to - range.from);
  return {
    from: range.from,
    to: Math.max(range.from, range.from + insertedSize),
  };
}

/** Keep the AI edit range when the editor selection collapses (e.g. prompt focus). */
export function nextInlineDraftAiScope(
  previous: InlineDraftAiRange,
  next: InlineDraftAiRange,
): InlineDraftAiRange {
  if (next.to > next.from) return next;
  return previous;
}
