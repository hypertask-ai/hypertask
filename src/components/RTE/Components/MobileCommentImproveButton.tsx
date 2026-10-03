"use client";

import type { Editor } from "@tiptap/react";
import { Check, Loader2, Sparkles } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MobileBottomSheet } from "@/components/Modals/Sheets";
import { UndoToaster } from "@/components/undoToast";
import { currentProjectAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import { tiptapForwardSlashRoute } from "@/lib/constants/APIRouteConstants";

type ImproveCommand =
  "ImproveReadability" | "MakeShorter" | "FixSpellingAndGrammar";

const actions: Array<{
  command: ImproveCommand;
  label: string;
  loadingLabel: string;
}> = [
  {
    command: "ImproveReadability",
    label: "Improve readability",
    loadingLabel: "Improving readability…",
  },
  {
    command: "MakeShorter",
    label: "Make shorter",
    loadingLabel: "Making it shorter…",
  },
  {
    command: "FixSpellingAndGrammar",
    label: "Fix spelling and grammar",
    loadingLabel: "Fixing spelling and grammar…",
  },
];

const htmlToPlainText = (html: string) =>
  new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ??
  "";

const requestImprovedContent = async ({
  content,
  command,
  projectId,
  signal,
}: {
  content: string;
  command: ImproveCommand;
  projectId?: number | null;
  signal: AbortSignal;
}) => {
  const response = await fetch(tiptapForwardSlashRoute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, command, projectId }),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Unable to improve this comment. Please try again.",
    );
  }

  const payload = await response.json();
  if (!payload.corrected_html || typeof payload.corrected_html !== "string") {
    throw new Error("AI returned no improved text. Please try again.");
  }

  return payload.corrected_html;
};

const MobileCommentImproveButton = ({ editor }: { editor: Editor | null }) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || loadingLabel || suggestion) return;
    const frame = requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, loadingLabel, suggestion]);

  const resetSheet = () => {
    setLoadingLabel(null);
    setSuggestion(null);
    setOriginalContent(null);
    setError(null);
    triggerRef.current?.focus();
  };

  const closeSheet = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsOpen(false);
  };

  const runAction = async (action: (typeof actions)[number]) => {
    if (!editor || loadingLabel) return;

    const content = editor.getHTML();
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setOriginalContent(content);
    setSuggestion(null);
    setError(null);
    setLoadingLabel(action.loadingLabel);

    try {
      const improved = await requestImprovedContent({
        content,
        command: action.command,
        projectId: currentProject?.id,
        signal: controller.signal,
      });
      setSuggestion(improved);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to improve this comment. Please try again.",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoadingLabel(null);
    }
  };

  const acceptSuggestion = () => {
    if (!editor || !suggestion || !originalContent) return;

    if (editor.getHTML() !== originalContent) {
      setSuggestion(null);
      setOriginalContent(null);
      setError(
        "This comment changed while AI was working. Choose an action again to use the latest text.",
      );
      return;
    }

    editor.commands.setContent(suggestion);
    editor.commands.focus("end");
    UndoToaster(
      "Suggestion applied. Undo?",
      originalContent,
      async (contentBefore, toastId) => {
        if (editor.getHTML() !== suggestion) {
          toast.dismiss(toastId);
          toast.error(
            "This comment changed after the suggestion. Undo was not applied.",
          );
          return;
        }
        editor.commands.setContent(contentBefore);
        editor.commands.focus("end");
        toast.dismiss(toastId);
      },
      true,
    );
    closeSheet();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2 text-meta font-semibold text-hypertasks-ai-purple touch-manipulation"
      >
        <Sparkles size={16} strokeWidth={1.75} aria-hidden />
        <span className="whitespace-nowrap">Improve with AI</span>
      </button>

      <MobileBottomSheet
        isOpen={isOpen}
        onClose={closeSheet}
        onCloseEnd={resetSheet}
        labelledBy="mobile-comment-improve-title"
        contentClassName="pb-2"
        bottomSlot={
          suggestion ? (
            <div className="flex gap-2 px-4 pb-3 pt-2">
              <button
                type="button"
                onClick={closeSheet}
                className="min-h-11 flex-1 rounded-sm bg-hover-active px-3 text-content font-semibold text-white-black"
              >
                Keep original
              </button>
              <button
                type="button"
                onClick={acceptSuggestion}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-sm bg-hypertasks-ai-purple px-3 text-content font-semibold text-black"
              >
                <Check size={17} strokeWidth={2} aria-hidden />
                Use suggestion
              </button>
            </div>
          ) : null
        }
      >
        <div className="px-4 pb-2 pt-1">
          <h2
            id="mobile-comment-improve-title"
            className="text-subheading font-medium text-white-black"
          >
            {suggestion ? "Review suggestion" : "Improve with AI"}
          </h2>
          <p className="mt-1 text-meta text-text-light-gray">
            {suggestion
              ? "Your comment will change only when you use this suggestion."
              : "Choose what should change. Your original stays until you accept."}
          </p>
        </div>

        {loadingLabel ? (
          <div
            className="flex min-h-[132px] items-center justify-center gap-2 px-4 text-content text-text-light-gray"
            role="status"
          >
            <Loader2
              size={18}
              strokeWidth={2}
              className="animate-spin text-hypertasks-ai-purple"
              aria-hidden
            />
            {loadingLabel}
          </div>
        ) : suggestion ? (
          <div className="mx-4 max-h-[34svh] overflow-y-auto rounded-[4px] bg-cardBackground px-3 py-3 text-content leading-relaxed text-white-black">
            {htmlToPlainText(suggestion)}
          </div>
        ) : (
          <div className="px-2">
            {actions.map((action, index) => (
              <button
                key={action.command}
                ref={index === 0 ? firstActionRef : undefined}
                type="button"
                onClick={() => void runAction(action)}
                className="flex min-h-[52px] w-full items-center px-3 text-left text-content text-white-black hover:bg-hover-active focus-visible:bg-hover-active"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {error ? (
          <p className="px-4 py-3 text-content text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </MobileBottomSheet>
    </>
  );
};

export default MobileCommentImproveButton;
