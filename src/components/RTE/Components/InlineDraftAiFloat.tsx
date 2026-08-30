"use client";

import { useEffect, useRef, useState } from "react";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { LoaderCircle } from "lucide-react";
import toast from "react-hot-toast";

import { SendArrow } from "@/components/Common/AttachmentsUpload";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";
import { AI_SUGGEST_REPLY_EVENT } from "@/lib/constants/aiEvents";
import {
  inlineDraftAiCommandForInstruction,
  inlineDraftAiWritePlaceholder,
  mergeInlineDraftAiDictation,
  nextInlineDraftAiScope,
  resolveInitialInlineDraftAiRange,
  rewrittenInlineDraftAiRange,
  shouldShowInlineDraftAiChips,
  type InlineDraftAiRange,
} from "./inlineDraftAi";

const CHIP_LINK_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 text-text-light-gray hover:bg-hover-active hover:text-white-black focus-visible:outline-none focus-visible:bg-hypertasks-ai-purple focus-visible:font-semibold focus-visible:text-white disabled:opacity-50";
const CHIP_DONE_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium text-white-black hover:bg-hover-active focus-visible:outline-none disabled:opacity-50";
const CHIP_PRIMARY_CLASS =
  "text-meta whitespace-nowrap rounded-sm px-1.5 py-0.5 font-semibold bg-hypertasks-ai-purple text-white hover:opacity-90 focus-visible:outline-none disabled:opacity-50";

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
}: {
  editor: Editor;
  onClose: () => void;
  projectId?: number | null;
  taskId?: number | null;
  allowSuggestReply?: boolean;
  toggleRecording?: (val: boolean) => void;
  isRecording?: boolean;
}) => {
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<InlineDraftAiRange | null>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioProcessing, setAudioProcessing] = useState(false);
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

  useEffect(() => {
    if (!editor) return;

    const current = editor.state.selection;
    const initial = resolveInitialInlineDraftAiRange({
      from: current.from,
      to: current.to,
      docSize: editor.state.doc.content.size,
      isEmpty: editor.isEmpty,
    });

    if (initial.from !== current.from || initial.to !== current.to) {
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
  }, [editor]);

  const close = () => {
    requestIdRef.current += 1;
    if (recordingRef.current && toggleRecording) {
      toggleRecording(false);
    }
    if (!editor.isEditable && wasEditableRef.current) {
      editor.setEditable(true);
    }
    onClose();
    editor.commands.focus();
  };
  closeRef.current = close;

  // Esc / Tab work even when focus is in the editor, not the float.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [editor]);

  if (!editor || !scope) return null;

  const hasSelection = scope.to > scope.from;
  const showEditChips = shouldShowInlineDraftAiChips(hasSelection, prompt);
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
    />
  ) : null;

  const replaceScope = (html: string, range: InlineDraftAiRange) => {
    const oldDocSize = editor.state.doc.content.size;
    const wholeDocument = range.from === 0 && range.to === oldDocSize;

    if (wholeDocument || editor.isEmpty) {
      editor.commands.setContent(html);
      editor.commands.selectAll();
      const next = editor.state.selection;
      setScope({ from: next.from, to: next.to });
      return;
    }

    editor
      .chain()
      .focus()
      .insertContentAt(range, html, { updateSelection: true })
      .run();
    const nextRange = rewrittenInlineDraftAiRange({
      oldDocSize,
      newDocSize: editor.state.doc.content.size,
      range,
    });
    editor.commands.setTextSelection(nextRange);
    setScope(nextRange);
  };

  const runAction = async (action: LastAction) => {
    if (loadingRef.current) return;

    const range = { ...scope };
    const selectionPresent = range.to > range.from;
    // Media-only / text drafts: require a range for edits. True empty docs
    // may WriteContent. Never treat media-only as empty write.
    if (!selectionPresent && action.command !== "WriteContent") return;
    if (
      !selectionPresent &&
      !editor.isEmpty &&
      action.command === "WriteContent"
    ) {
      return;
    }

    const content = selectionPresent ? selectedHtml(editor, range) : "";
    const requestId = ++requestIdRef.current;
    const toastId = `inline-draft-ai-${requestId}`;
    toastIdRef.current = toastId;
    loadingRef.current = true;
    setIsLoading(true);
    setHasResult(false);
    setLastAction(action);
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
      return data.corrected_html as string;
    })();

    try {
      const html = await toast.promise(
        request,
        {
          loading: "Rewriting draft",
          success: "Draft updated",
          error: (error) =>
            error instanceof Error ? error.message : "AI edit failed",
        },
        { id: toastId },
      );
      if (requestId !== requestIdRef.current) return;
      replaceScope(html, range);
      setPrompt("");
      setHasResult(true);
    } catch {
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
    void runAction({
      command: inlineDraftAiCommandForInstruction(hasSelection),
      instruction,
    });
  };

  const retry = () => {
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

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Write with AI"
      aria-modal="false"
      className="my-2 flex w-full min-w-0 flex-col gap-2 rounded-[4px] border-thin border-hypertasks-ai-purple/70 bg-comment-description px-2 py-1.5 text-content shadow-md"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        // Let focused chip / Done / Retry / Send activate normally.
        if ((event.target as HTMLElement | null)?.tagName === "BUTTON") return;
        // Stop Ctrl/Cmd+Enter from also firing the parent comment Send.
        event.preventDefault();
        event.stopPropagation();
        submitPrompt();
      }}
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        <div
          className={
            dictationActive ? "hidden" : "min-w-[150px] flex-1"
          }
        >
          <input
            autoFocus
            maxLength={2_000}
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

      {showEditChips && (
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
      )}
    </div>
  );
};

export default InlineDraftAiFloat;
