"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

import { LoaderCircle, X } from "lucide-react";
import toast from "react-hot-toast";

import { SendArrow } from "@/components/Common/SendArrow";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { AppSheet } from "@/components/Modals/Sheets/AppSheet";
import {
  MOBILE_OVERLAY_SHEET_Z,
  mobileOverlayAppSheetBodyClass,
  mobileOverlayAppSheetHandleBarClass,
  mobileOverlayAppSheetHandleHeaderClass,
  mobileOverlayAppSheetHandleRowClass,
  mobileOverlayAppSheetPanelClass,
} from "@/components/Modals/Sheets/mobileOverlayAppSheetStyles";
import { getMobileOverlaySheetContainerStyle } from "@/lib/mobileCommentViewport";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import styles from "@/styles/tiptap.module.scss";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import {
  createInlineDraftAiSourceSnapshot,
  initialInlineDraftAiReviewState,
  INLINE_DRAFT_AI_PROMPT_MAX_LENGTH,
  inlineDraftAiCommandForInstruction,
  inlineDraftAiReviewReducer,
  inlineDraftAiWritePlaceholder,
  isInlineDraftAiSourceFresh,
  mergeInlineDraftAiDictation,
  nextInlineDraftAiScope,
  resolveInitialInlineDraftAiRange,
  rewrittenInlineDraftAiRange,
  shouldShowInlineDraftAiChips,
  type InlineDraftAiRange,
  type InlineDraftAiRequestDescriptor,
  type InlineDraftAiSourceSnapshot,
} from "./inlineDraftAi";
import { sanitizeAiHtml } from "@/utils/helperFunctions/sanitizeHtml";

const CHIP_LINK_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 text-text-light-gray hover:bg-hover-active hover:text-white-black focus-visible:outline-none focus-visible:bg-hypertasks-ai-purple focus-visible:font-semibold focus-visible:text-white disabled:opacity-50";
const CHIP_DONE_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium text-white-black hover:bg-hover-active focus-visible:outline-none disabled:opacity-50";
const CHIP_PRIMARY_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 font-semibold bg-hypertasks-ai-purple text-white hover:opacity-90 focus-visible:outline-none disabled:opacity-50";
const CHIP_SHEET_ROW_CLASS =
  "flex min-h-11 items-center rounded-full bg-hover-active px-3 text-left text-dense text-white-black active:opacity-80 disabled:opacity-50";

const EDIT_ACTIONS = [
  ["Improve readability", "ImproveReadability"],
  ["Fix spelling and grammar", "FixSpellingAndGrammar"],
  ["Simplify", "Simplify"],
  ["Unslop", "Unslop"],
  ["Structured", "Structured"],
] as const;

interface LastAction {
  command: string;
  instruction?: string;
  label?: string;
  sourceContent?: string;
}

interface MobileOpeningSource {
  html: string;
  snapshot: InlineDraftAiSourceSnapshot;
}

function selectedHtml(editor: Editor, range: InlineDraftAiRange) {
  const wrapper = document.createElement("div");
  const fragment = editor.state.doc.slice(range.from, range.to).content;
  wrapper.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment),
  );
  return wrapper.innerHTML;
}

function focusablesIn(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

const InlineDraftAiFloat = ({
  editor,
  onClose,
  projectId,
  taskId,
  allowSuggestReply = false,
  toggleRecording,
  isRecording = false,
  presentation = "inline",
  suppressEditorSelectionHighlight = false,
}: {
  editor: Editor;
  onClose: () => void;
  projectId?: number | null;
  taskId?: number | null;
  allowSuggestReply?: boolean;
  toggleRecording?: (val: boolean) => void;
  isRecording?: boolean;
  presentation?: "inline" | "composer" | "refine-fullscreen";
  suppressEditorSelectionHighlight?: boolean;
}) => {
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<InlineDraftAiRange | null>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [mobileReview, dispatchMobileReview] = useReducer(
    inlineDraftAiReviewReducer,
    initialInlineDraftAiReviewState,
  );
  const requestIdRef = useRef(0);
  const toastIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const wasEditableRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const recordingRef = useRef(false);
  const audioProcessingRef = useRef(false);
  const allowSuggestReplyRef = useRef(allowSuggestReply);
  const promptRef = useRef(prompt);
  const mobilePromptInputRef = useRef<HTMLInputElement>(null);
  const mobileOpeningSourceRef = useRef<MobileOpeningSource | null>(null);

  useEffect(() => {
    allowSuggestReplyRef.current = allowSuggestReply;
  }, [allowSuggestReply]);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    recordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    audioProcessingRef.current = audioProcessing;
  }, [audioProcessing]);

  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  const isComposer = presentation === "composer";
  const isRefineFullscreen = presentation === "refine-fullscreen";
  const isMobileAiSheet = isRefineFullscreen || isComposer;
  const sheetViewport = useMobileVisualViewport(isMobileAiSheet);
  const sheetContainerStyle = getMobileOverlaySheetContainerStyle(sheetViewport);

  const focusPromptInSheet = useCallback(() => {
    if (!isMobileAiSheet || mobileReview.phase !== "input") return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const input = mobilePromptInputRef.current;
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    });
  }, [isMobileAiSheet, mobileReview.phase]);

  useEffect(() => {
    if (mobileReview.isRefining) focusPromptInSheet();
  }, [focusPromptInSheet, mobileReview.isRefining]);

  useEffect(() => {
    const input = mobilePromptInputRef.current;
    if (
      !isMobileAiSheet ||
      !input ||
      document.activeElement !== input
    ) {
      return;
    }
    input.scrollIntoView({ block: "nearest" });
  }, [
    isMobileAiSheet,
    sheetViewport?.bottomInset,
    sheetViewport?.visibleHeight,
  ]);

  useEffect(() => {
    if (!isMobileAiSheet) return;
    const previous = window.__htHandleBack;
    window.__htHandleBack = () => {
      closeRef.current();
      return true;
    };
    return () => {
      window.__htHandleBack = previous;
    };
  }, [isMobileAiSheet]);

  useEffect(() => {
    if (!editor) return;

    const current = editor.state.selection;
    const initial = resolveInitialInlineDraftAiRange({
      from: current.from,
      to: current.to,
      docSize: editor.state.doc.content.size,
      isEmpty: editor.isEmpty,
    });

    if (
      !suppressEditorSelectionHighlight &&
      (initial.from !== current.from || initial.to !== current.to)
    ) {
      editor.commands.setTextSelection(initial);
    }
    setScope(initial);

    // Only adopt non-collapsed selections. Focusing the prompt blurs the
    // editor and collapses PM selection — that must not wipe the AI scope.
    const syncScope = () => {
      if (loadingRef.current) return;
      const { from, to } = editor.state.selection;
      setScope((previous) =>
        previous
          ? nextInlineDraftAiScope(previous, { from, to })
          : { from, to },
      );
    };
    editor.on("selectionUpdate", syncScope);

    return () => {
      requestIdRef.current += 1;
      if (toastIdRef.current) toast.dismiss(toastIdRef.current);
      editor.off("selectionUpdate", syncScope);
      if (!editor.isEditable && wasEditableRef.current) {
        editor.setEditable(true);
      }
    };
  }, [editor, suppressEditorSelectionHighlight]);

  const close = () => {
    requestIdRef.current += 1;
    if (recordingRef.current && toggleRecording) {
      toggleRecording(false);
    }
    if (!editor.isEditable && wasEditableRef.current) {
      editor.setEditable(true);
    }
    if (suppressEditorSelectionHighlight) {
      editor.commands.unsetHighlight();
      const { from } = editor.state.selection;
      editor.commands.setTextSelection(from);
    }
    onClose();
    if (isMobileAiSheet) {
      editor.commands.focus("end");
    }
  };
  closeRef.current = close;

  // Esc / Tab work even when focus is in the editor, not the float.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (recordingRef.current || audioProcessingRef.current) {
          // Let AudioButton cancel recording; closing here would strand isRecording.
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }

      if (
        allowSuggestReplyRef.current &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (
          !loadingRef.current &&
          !recordingRef.current &&
          !audioProcessingRef.current &&
          !promptRef.current.trim() &&
          editor.isEmpty
        ) {
          window.dispatchEvent(new CustomEvent(AI_SUGGEST_REPLY_EVENT));
        }
        return;
      }

      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;

      const items = focusablesIn(root);
      if (items.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const active = document.activeElement as HTMLElement | null;
      const index = active ? items.indexOf(active) : -1;
      const nextIndex = event.shiftKey
        ? (index <= 0 ? items.length - 1 : index - 1)
        : (index + 1) % items.length;
      items[nextIndex]?.focus();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  // Dismiss when clicking outside the float. Keep open for draft clicks so
  // users can adjust the selection without the bar disappearing.
  useEffect(() => {
    if (isMobileAiSheet) return;

    const onPointerDown = (event: PointerEvent) => {
      if (loadingRef.current || recordingRef.current || audioProcessingRef.current) {
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      const target = event.target as Node;
      if (root.contains(target)) return;
      if (editor.view.dom.contains(target)) return;
      closeRef.current();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [editor, isMobileAiSheet]);

  if (!editor || !scope) return null;

  if (isMobileAiSheet && !mobileOpeningSourceRef.current) {
    mobileOpeningSourceRef.current = {
      html: selectedHtml(editor, scope),
      snapshot: createInlineDraftAiSourceSnapshot(editor.state.doc, scope),
    };
  }
  const mobileOpeningSource = mobileOpeningSourceRef.current;
  const hasOpeningDraft = Boolean(mobileOpeningSource?.html);
  const hasSelection = scope.to > scope.from;
  const showEditChips =
    (isMobileAiSheet && hasOpeningDraft) ||
    shouldShowInlineDraftAiChips(hasSelection, prompt);
  const showDictation = Boolean(toggleRecording);
  const dictationActive = isRecording || audioProcessing;

  const appendDictation = (text: string, setContent?: boolean) => {
    setPrompt((current) =>
      mergeInlineDraftAiDictation(current, text, Boolean(setContent)),
    );
  };

  const dictationButton = showDictation ? (
    <AudioButton
      toggleRecording={toggleRecording!}
      callbackHandler={appendDictation}
      defaultContent={prompt}
      editor={null}
      id="inline-draft-ai-audio-button"
      globalRecording={isRecording}
      hasText={Boolean(prompt.trim())}
      onProcessingChange={setAudioProcessing}
      ariaLabel="Dictate AI prompt"
      mobilePresentation={isMobileAiSheet ? "prominent" : undefined}
      wrapperClassName={
        isMobileAiSheet && !prompt.trim() ? "ml-auto" : undefined
      }
      disabled={isLoading}
    />
  ) : null;

  const replaceScope = (html: string, range: InlineDraftAiRange) => {
    const oldDocSize = editor.state.doc.content.size;
    const wholeDocument = range.from === 0 && range.to === oldDocSize;

    if (wholeDocument || editor.isEmpty) {
      editor.commands.setContent(html);
      if (suppressEditorSelectionHighlight) {
        const newSize = editor.state.doc.content.size;
        setScope({ from: 0, to: newSize });
      } else {
        editor.commands.selectAll();
        const next = editor.state.selection;
        setScope({ from: next.from, to: next.to });
      }
      return;
    }

    editor
      .chain()
      .focus()
      .insertContentAt(range, html, {
        updateSelection: !suppressEditorSelectionHighlight,
      })
      .run();
    const nextRange = rewrittenInlineDraftAiRange({
      oldDocSize,
      newDocSize: editor.state.doc.content.size,
      range,
    });
    if (!suppressEditorSelectionHighlight) {
      editor.commands.setTextSelection(nextRange);
    }
    setScope(nextRange);
  };

  const runAction = async (action: LastAction) => {
    if (loadingRef.current) return;

    const range = { ...scope };
    const selectionPresent = range.to > range.from;
    const content =
      action.sourceContent ??
      (selectionPresent ? selectedHtml(editor, range) : "");
    // Media-only / text drafts require content for edits. True empty docs may
    // WriteContent. The mobile refine path intentionally edits its proposal,
    // while the opening editor remains untouched.
    if (!content && action.command !== "WriteContent") return;
    if (
      !isMobileAiSheet &&
      !selectionPresent &&
      !editor.isEmpty &&
      action.command === "WriteContent"
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const toastId = `inline-draft-ai-${requestId}`;
    const mobileDescriptor: InlineDraftAiRequestDescriptor | null =
      isMobileAiSheet
        ? {
            command: action.command,
            instruction: action.instruction,
            label: action.label ?? "AI edit",
            sourceContent: content,
          }
        : null;
    toastIdRef.current = toastId;
    loadingRef.current = true;
    setIsLoading(true);
    setHasResult(false);
    setLastAction(action);
    if (mobileDescriptor) {
      dispatchMobileReview({
        type: "request",
        requestId,
        descriptor: mobileDescriptor,
      });
    }
    wasEditableRef.current = editor.isEditable;
    editor.setEditable(false);

    const request = (async () => {
      const response = await fetch(tiptapForwardSlashRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          command: action.command,
          instruction: action.instruction,
          projectId,
          taskId,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to rewrite this draft. Please try again.",
        );
      }
      if (typeof data?.corrected_html !== "string" || !data.corrected_html) {
        throw new Error("AI returned no draft. Please try again.");
      }
      if (!isMobileAiSheet) return data.corrected_html as string;
      const sanitizedHtml = sanitizeAiHtml(data.corrected_html as string);
      if (!sanitizedHtml) {
        throw new Error("AI returned no usable draft. Please try again.");
      }
      return sanitizedHtml;
    })();

    try {
      const html = await toast.promise(
        request,
        {
          loading:
            action.command === "WriteContent"
              ? "Writing draft"
              : "Rewriting draft",
          success: isMobileAiSheet ? "Draft ready to review" : "Draft updated",
          error: (error) =>
            error instanceof Error ? error.message : "AI edit failed",
        },
        { id: toastId },
      );
      if (requestId !== requestIdRef.current) return;
      setPrompt("");
      if (isMobileAiSheet) {
        dispatchMobileReview({ type: "resolve", requestId, proposal: html });
        return;
      }
      replaceScope(html, range);
      setHasResult(true);
    } catch {
      if (isMobileAiSheet) {
        dispatchMobileReview({ type: "reject", requestId });
      }
      // toast.promise already reports the request error.
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setIsLoading(false);
        if (wasEditableRef.current) editor.setEditable(true);
      }
    }
  };

  const submitPrompt = () => {
    const instruction = prompt.trim();
    if (!instruction) return;
    if (isMobileAiSheet) {
      const sourceContent = mobileReview.isRefining
        ? mobileReview.proposal
        : mobileOpeningSource?.html ?? "";
      let label = "Write comment";
      if (mobileReview.isRefining) label = "Refine";
      else if (hasOpeningDraft) label = "Custom instruction";
      void runAction({
        command: sourceContent ? "CustomEdit" : "WriteContent",
        instruction,
        label,
        sourceContent,
      });
      return;
    }
    void runAction({
      command: inlineDraftAiCommandForInstruction(hasSelection),
      instruction,
    });
  };

  const retry = () => {
    if (isMobileAiSheet) {
      if (!mobileReview.lastRequest) return;
      void runAction(mobileReview.lastRequest);
      return;
    }
    if (!lastAction) return;
    void runAction(
      lastAction.instruction
        ? {
            command: inlineDraftAiCommandForInstruction(hasSelection),
            instruction: lastAction.instruction,
          }
        : lastAction,
    );
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter") return;
    if ((event.target as HTMLElement | null)?.tagName === "BUTTON") return;
    event.preventDefault();
    event.stopPropagation();
    submitPrompt();
  };

  const promptRow = (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className={dictationActive ? "hidden" : "min-w-[150px] flex-1"}>
        <input
          autoFocus
          maxLength={INLINE_DRAFT_AI_PROMPT_MAX_LENGTH}
          value={prompt}
          disabled={isLoading || audioProcessing}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={inlineDraftAiWritePlaceholder(
            hasSelection,
            allowSuggestReply,
            editor.isEmpty,
          )}
          className="w-full border-0 bg-transparent px-1 py-1.5 text-white-black outline-none placeholder:text-text-light-gray"
        />
      </div>

      {dictationButton && (
        <div
          className={
            dictationActive ? "min-w-0 flex-1" : isLoading ? "hidden" : "shrink-0"
          }
        >
          {dictationButton}
        </div>
      )}

      <button
        type="button"
        aria-label="Send AI instruction"
        disabled={!prompt.trim() || isLoading || audioProcessing}
        onClick={submitPrompt}
        className={`${dictationActive ? "hidden" : "flex"} h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hypertasks-ai-purple text-white disabled:bg-icon-dark-gray disabled:text-comment-description`}
      >
        {isLoading ? (
          <LoaderCircle size={15} className="animate-spin" aria-hidden />
        ) : (
          <SendArrow size={16} />
        )}
      </button>
    </div>
  );

  const inlineEditChips = showEditChips ? (
    <div className="scrollbar-none flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto">
      {hasResult && (
        <>
          <button type="button" className={CHIP_DONE_CLASS} onClick={close}>
            Done
          </button>
          <button
            type="button"
            className={CHIP_PRIMARY_CLASS}
            onClick={retry}
            disabled={isLoading}
          >
            Retry
          </button>
        </>
      )}
      {EDIT_ACTIONS.map(([label, command]) => (
        <button
          key={command}
          type="button"
          disabled={isLoading}
          className={CHIP_LINK_CLASS}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void runAction({ command })}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const useMobileProposal = () => {
    if (!mobileOpeningSource || !mobileReview.proposal) return;
    if (
      !isInlineDraftAiSourceFresh(
        editor.state.doc,
        mobileOpeningSource.snapshot,
      )
    ) {
      toast.error(
        "This comment changed while AI was working. Your draft and the proposal were both preserved.",
      );
      return;
    }
    replaceScope(
      mobileReview.proposal,
      mobileOpeningSource.snapshot.range,
    );
    closeRef.current();
  };

  const beginMobileRefine = () => {
    setPrompt(mobileReview.lastRequest?.instruction ?? "");
    dispatchMobileReview({ type: "refine" });
  };

  let mobilePromptPlaceholder = "Describe the comment you want to write…";
  if (mobileReview.isRefining) {
    mobilePromptPlaceholder = "Tell AI how to refine this proposal…";
  } else if (hasOpeningDraft) {
    mobilePromptPlaceholder = "Or tell it what to change…";
  }

  const mobilePromptComposer = (
    <div
      data-mobile-write-ai-prompt
      className="mt-3 rounded-lg bg-newcomment-well px-3 pb-2 pt-3"
      onKeyDown={handlePanelKeyDown}
    >
      {!dictationActive && (
        <input
          ref={mobilePromptInputRef}
          autoFocus
          maxLength={INLINE_DRAFT_AI_PROMPT_MAX_LENGTH}
          value={prompt}
          disabled={isLoading || audioProcessing}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={mobilePromptPlaceholder}
          className="min-h-11 w-full border-0 bg-transparent text-[16px] leading-6 text-white-black outline-none placeholder:text-text-light-gray"
        />
      )}
      <div className="flex min-h-11 w-full items-center gap-2">
        {dictationButton}
        {prompt.trim() && !dictationActive ? (
          <button
            type="button"
            aria-label="Send AI instruction"
            disabled={isLoading || audioProcessing}
            onClick={submitPrompt}
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hypertasks-ai-purple text-white disabled:opacity-50"
          >
            <SendArrow size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );

  if (isRefineFullscreen || isComposer) {
    const inputSource = mobileReview.isRefining
      ? mobileReview.proposal
      : mobileOpeningSource?.html ?? "";
    const reviewContent = sanitizeAiHtml(
      mobileReview.showOriginal
        ? mobileOpeningSource?.html ?? ""
        : mobileReview.proposal,
    );

    return (
      <AppSheet
        isOpen
        onClose={close}
        ariaLabel="Write with AI"
        defaultLibraryHeader={false}
        zIndex={MOBILE_OVERLAY_SHEET_Z}
        detent="full-height"
        disableScrollLocking
        onOpenStart={focusPromptInSheet}
        onOpenEnd={focusPromptInSheet}
        panelClassName={cn(
          mobileOverlayAppSheetPanelClass,
          sheetContainerStyle && "!h-full !max-h-full",
        )}
        bodyClassName={cn(
          mobileOverlayAppSheetBodyClass,
          sheetContainerStyle ? "h-full max-h-full" : "!max-h-[85svh]",
        )}
        headerClassName={mobileOverlayAppSheetHandleHeaderClass}
        handleRowClassName={mobileOverlayAppSheetHandleRowClass}
        handleBarClassName={mobileOverlayAppSheetHandleBarClass}
        containerStyle={sheetContainerStyle}
      >
        <div
          ref={rootRef}
          className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-ai-chat text-meta"
        >
          <div className="z-10 flex shrink-0 items-center justify-between gap-4 px-3 py-2 text-content text-white-black">
            <h2 className="min-w-0 truncate font-medium">Write with AI</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close Write with AI"
              className="flex h-11 w-11 items-center justify-center text-icon-dark-gray hover:text-white-black"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-icon-dark-gray">
            {mobileReview.phase === "review" ? (
              <>
                <div className="rounded-[4px] bg-cardBackground px-3 py-3 text-content leading-relaxed text-white-black">
                  <p className="mb-2 text-micro font-bold uppercase tracking-wide text-hypertasks-ai-purple">
                    {mobileReview.showOriginal
                      ? "Your original"
                      : `AI proposal · ${mobileReview.lastRequest?.label ?? "Rewrite"}`}
                  </p>
                  {reviewContent ? (
                    <div
                      className={styles.editorContainer}
                      dangerouslySetInnerHTML={{ __html: reviewContent }}
                    />
                  ) : (
                    <p className="text-text-light-gray">Nothing written yet.</p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className={CHIP_SHEET_ROW_CLASS}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={beginMobileRefine}
                    className={CHIP_SHEET_ROW_CLASS}
                  >
                    Refine…
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatchMobileReview({ type: "toggle-original" })
                    }
                    className={CHIP_SHEET_ROW_CLASS}
                  >
                    {mobileReview.showOriginal
                      ? "Show proposal"
                      : "Show original"}
                  </button>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="min-h-11 flex-1 rounded-sm bg-hover-active px-3 text-content font-semibold text-white-black"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={useMobileProposal}
                    className="min-h-11 flex-1 rounded-sm bg-shadcn-primary px-3 text-content font-semibold text-primary-foreground"
                  >
                    Use this text
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-[4px] bg-cardBackground px-3 py-3 text-content leading-relaxed text-white-black">
                  <p className="mb-2 text-micro font-medium uppercase tracking-wide text-text-light-gray">
                    {mobileReview.isRefining
                      ? "AI proposal"
                      : hasOpeningDraft
                        ? "Your draft"
                        : "Comment"}
                  </p>
                  {inputSource ? (
                    <div
                      className={styles.editorContainer}
                      dangerouslySetInnerHTML={{
                        __html: sanitizeAiHtml(inputSource),
                      }}
                    />
                  ) : (
                    <p className="text-text-light-gray">
                      Nothing written yet. Describe it and AI will draft the comment.
                    </p>
                  )}
                </div>

                {mobileReview.phase === "loading" ? (
                  <div
                    className="flex min-h-[88px] items-center justify-center gap-2 text-content text-text-light-gray"
                    role="status"
                  >
                    <LoaderCircle
                      size={18}
                      className="animate-spin text-hypertasks-ai-purple"
                      aria-hidden
                    />
                    {mobileReview.lastRequest?.command === "WriteContent"
                      ? "Writing draft…"
                      : "Rewriting draft…"}
                  </div>
                ) : (
                  <>
                    {hasOpeningDraft && !mobileReview.isRefining ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {EDIT_ACTIONS.map(([label, command]) => (
                          <button
                            key={command}
                            type="button"
                            className={CHIP_SHEET_ROW_CLASS}
                            onClick={() =>
                              void runAction({
                                command,
                                label:
                                  command === "FixSpellingAndGrammar"
                                    ? "Fix spelling"
                                    : label,
                                sourceContent: mobileOpeningSource?.html ?? "",
                              })
                            }
                          >
                            {command === "FixSpellingAndGrammar"
                              ? "Fix spelling"
                              : label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {mobilePromptComposer}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </AppSheet>
    );
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Write with AI"
      aria-modal="false"
      className="my-2 flex w-full min-w-0 flex-col gap-2 rounded-[4px] border-thin border-hypertasks-ai-purple/70 bg-comment-description px-2 py-1.5 text-content shadow-md"
      onKeyDown={handlePanelKeyDown}
    >
      {promptRow}
      {inlineEditChips}
    </div>
  );
};

export default InlineDraftAiFloat;
