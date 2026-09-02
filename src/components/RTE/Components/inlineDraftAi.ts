import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const INLINE_DRAFT_AI_PROMPT_MAX_LENGTH = 2_000;

export interface InlineDraftAiRange {
  from: number;
  to: number;
}

export interface InlineDraftAiRequestDescriptor {
  readonly command: string;
  readonly instruction?: string;
  readonly label: string;
  readonly sourceContent: string;
  readonly sourceRevision?: number;
}

export interface InlineDraftAiReviewState {
  phase: "input" | "loading" | "review";
  proposal: string;
  showOriginal: boolean;
  isRefining: boolean;
  activeRequestId: number;
  lastRequest: InlineDraftAiRequestDescriptor | null;
}

export type InlineDraftAiReviewEvent =
  | {
      type: "request";
      requestId: number;
      descriptor: InlineDraftAiRequestDescriptor;
    }
  | { type: "resolve"; requestId: number; proposal: string }
  | { type: "reject"; requestId: number }
  | { type: "edit-proposal"; proposal: string }
  | { type: "refine" }
  | { type: "toggle-original" }
  | { type: "reset" };

export const initialInlineDraftAiReviewState: InlineDraftAiReviewState = {
  phase: "input",
  proposal: "",
  showOriginal: false,
  isRefining: false,
  activeRequestId: 0,
  lastRequest: null,
};

export function inlineDraftAiReviewReducer(
  state: InlineDraftAiReviewState,
  event: InlineDraftAiReviewEvent,
): InlineDraftAiReviewState {
  switch (event.type) {
    case "reset":
      return { ...initialInlineDraftAiReviewState };
    case "request":
      return {
        ...state,
        phase: "loading",
        showOriginal: false,
        activeRequestId: event.requestId,
        lastRequest: Object.freeze({ ...event.descriptor }),
      };
    case "resolve":
      if (event.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        phase: "review",
        proposal: event.proposal,
        showOriginal: false,
        isRefining: false,
      };
    case "reject":
      if (event.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        phase: state.proposal ? "review" : "input",
        isRefining: false,
      };
    case "edit-proposal":
      if (
        (!state.isRefining && state.phase !== "review") ||
        state.showOriginal
      ) {
        return state;
      }
      return { ...state, proposal: event.proposal };
    case "refine":
      if (!state.proposal) return state;
      return {
        ...state,
        phase: "input",
        showOriginal: false,
        isRefining: true,
      };
    case "toggle-original":
      if (state.phase !== "review") return state;
      return { ...state, showOriginal: !state.showOriginal };
  }
}

export interface InlineDraftAiSourceSnapshot {
  range: InlineDraftAiRange;
  documentJson: string;
}

export function createInlineDraftAiSourceSnapshot(
  document: ProseMirrorNode,
  range: InlineDraftAiRange,
): InlineDraftAiSourceSnapshot {
  return {
    range: { ...range },
    documentJson: JSON.stringify(document.toJSON()),
  };
}

export function isInlineDraftAiSourceFresh(
  document: ProseMirrorNode,
  snapshot: InlineDraftAiSourceSnapshot,
): boolean {
  return (
    snapshot.range.from >= 0 &&
    snapshot.range.to <= document.content.size &&
    JSON.stringify(document.toJSON()) === snapshot.documentJson
  );
}

export function applyInlineDraftAiProposalIfFresh({
  document,
  snapshot,
  proposal,
  apply,
}: {
  document: ProseMirrorNode;
  snapshot: InlineDraftAiSourceSnapshot;
  proposal: string;
  apply: (proposal: string, range: InlineDraftAiRange) => void;
}): boolean {
  if (!proposal || !isInlineDraftAiSourceFresh(document, snapshot)) {
    return false;
  }
  apply(proposal, snapshot.range);
  return true;
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
  return (replace ? dictated : current + dictated).slice(
    0,
    INLINE_DRAFT_AI_PROMPT_MAX_LENGTH,
  );
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
