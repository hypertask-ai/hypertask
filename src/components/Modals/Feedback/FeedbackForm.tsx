"use client";

import { uploadFilesViaApi } from "@/lib/storage/uploadViaApi";
import { EditorContent } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import toast from "react-hot-toast";
import useTiptap from "@/components/RTE/Tiptap";
import AudioButton from "@/components/RTE/Components/AudioButton";
import tiptapStyles from "@/styles/tiptap.module.scss";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { FeedbackKind, sendFeedbackRequest } from "./sendFeedbackRequest";
import { selectFeedbackKind } from "./feedbackKindSelection";

const feedbackKinds: FeedbackKind[] = ["Bug", "Idea", "Question", "Praise"];

// Tiptap serializes an empty editor as "<p></p>"; treat that (and runs of
// empty paragraphs left behind by clearing content) as no text, the same way
// an empty plain-text field would be.
export const isFeedbackTextEmpty = (html: string) =>
  html.replace(/<p>\s*<\/p>/gi, "").trim().length === 0;

type UseFeedbackDraftOptions = {
  clearOnSuccess?: boolean;
  onSuccess?: () => void;
};

export const useFeedbackDraft = ({
  clearOnSuccess = false,
  onSuccess,
}: UseFeedbackDraftOptions = {}) => {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FeedbackKind>("Bug");
  const [notify, setNotify] = useState(true);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isDictationProcessing, setIsDictationProcessing] = useState(false);
  const isDictating = isRecording || isDictationProcessing;
  const submitFeedback = async () => {
    if (isFeedbackTextEmpty(text) || isSubmitting || isDictating) return;

    setIsSubmitting(true);
    try {
      const screenshotUrl = screenshot
        ? (await uploadFilesViaApi([screenshot]))[0]
        : undefined;
      await sendFeedbackRequest(text, {
        kind,
        notify,
        pathname: (window.location.pathname + window.location.search).slice(
          0,
          300,
        ),
        pageTitle: document.title.slice(0, 300),
        userAgent: navigator.userAgent.slice(0, 300),
        appVersion: process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 300),
        screenshotUrl,
      });
      toast.success("Feedback sent. Thank you!");
      if (clearOnSuccess) {
        setText("");
        setKind("Bug");
        setNotify(true);
        setScreenshot(null);
      }
      onSuccess?.();
    } catch {
      toast.error("Unable to send feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isSubmitting,
    isDictating,
    isDictationProcessing,
    isRecording,
    kind,
    notify,
    screenshot,
    setKind,
    setNotify,
    setScreenshot,
    setIsDictationProcessing,
    setIsRecording,
    setText,
    submitFeedback,
    text,
  };
};

type FeedbackFieldsProps = {
  autoFocus?: boolean;
  draft: ReturnType<typeof useFeedbackDraft>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
// Kept in step with IMAGE_EXTENSIONS in src/app/api/feedback/route.ts: a format the
// picker offers but the route rejects fails only after the upload, as a bare toast.
const SCREENSHOT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.avif";

// The upload URL is not encoded, and the route parses it with `new URL`. A file
// named "screen#1.jpg" turns everything after the # into a fragment, so the path
// stops ending in .jpg and the attachment is rejected; a very long name blows the
// 300-char URL limit the same way. Neither is the user's problem: rename to a
// fixed name and keep only the extension.
const safeScreenshotName = (name: string) => {
  const extension = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ".png";
  return `feedback-screenshot${extension}`;
};

export const FeedbackFields = ({
  autoFocus = false,
  draft,
  onKeyDown,
}: FeedbackFieldsProps) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const shouldRestoreEditorFocus = useRef(false);
  const currentUser = useRecoilValue(currentUserAtom);
  const { editor } = useTiptap({
    mode: "create-comment",
    defaultContent: draft.text,
    placeholder: "What's broken, missing, or annoying?",
  });

  const restoreEditorFocus = useCallback(() => {
    editor?.commands.focus("end");
  }, [editor]);

  // Mobile file pickers background the WebView. Restore the editor when the
  // picker returns so adding or cancelling a screenshot does not strand the
  // composer without a keyboard.
  useEffect(() => {
    const restoreAfterPicker = () => {
      if (
        !shouldRestoreEditorFocus.current ||
        document.visibilityState === "hidden"
      ) {
        return;
      }
      shouldRestoreEditorFocus.current = false;
      window.setTimeout(restoreEditorFocus, 0);
    };

    window.addEventListener("focus", restoreAfterPicker);
    document.addEventListener("visibilitychange", restoreAfterPicker);
    return () => {
      window.removeEventListener("focus", restoreAfterPicker);
      document.removeEventListener("visibilitychange", restoreAfterPicker);
    };
  }, [restoreEditorFocus]);

  const insertDictation = useCallback(
    (text: string, setContent = false) => {
      if (!editor) return;
      if (setContent) editor.commands.setContent(text);
      else editor.commands.insertContent(text);
      draft.setText(editor.getHTML());
      editor.commands.focus("end");
    },
    [draft, editor],
  );

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => draft.setText(editor.getHTML());
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (autoFocus) editor?.commands.focus("end");
  }, [autoFocus, editor]);

  // A cleared draft (post-submit reset, or a fresh mount) must clear the
  // editor's own document too — draft.text is just a mirror of it.
  useEffect(() => {
    if (draft.text === "" && editor && !editor.isEmpty) {
      editor.commands.clearContent();
    }
  }, [draft.text, editor]);

  return (
  <>
    <div className="flex gap-1.5 border-b border-light-black-border-1 px-4 py-3">
      {feedbackKinds.map((feedbackKind) => (
        <button
          key={feedbackKind}
          type="button"
          aria-pressed={draft.kind === feedbackKind}
          onClick={() =>
            selectFeedbackKind(
              feedbackKind,
              draft.setKind,
              restoreEditorFocus,
            )
          }
          // Selected uses label-span, not active-modal-element: in the light theme
          // the latter is darker than the panel but LIGHTER than an unselected
          // chip, so the picked kind read as the only unpicked one.
          className={`flex-1 rounded-sm px-3 py-2 text-dense text-white-black hover:bg-label-span ${
            draft.kind === feedbackKind
              ? "bg-label-span font-medium"
              : "bg-comment-description"
          }`}
        >
          {feedbackKind}
        </button>
      ))}
    </div>
    <div className="border-b border-light-black-border-1">
      <EditorContent
        aria-label="Feedback"
        onKeyDown={onKeyDown}
        editor={editor}
        // editorContainer carries the placeholder ::before styling shared with
        // the comment/description editors (tiptap.module.scss).
        className={`${tiptapStyles.editorContainer} min-h-[180px] w-full cursor-text bg-inherit px-4 py-3 text-content text-white-black`}
      />
    </div>
    <div className="flex min-h-14 items-center gap-3 px-4 py-1.5 text-dense">
      {/* A file, not getDisplayMedia: the share picker captures the screen with
          this modal open on top of it, so the live capture only ever showed the
          person writing the feedback, never the thing they are reporting. */}
      <input
        ref={fileInput}
        type="file"
        accept={SCREENSHOT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first: picking the same file twice must still fire onChange.
          event.target.value = "";
          shouldRestoreEditorFocus.current = false;
          if (!file) {
            restoreEditorFocus();
            return;
          }
          if (file.size > MAX_SCREENSHOT_BYTES) {
            toast.error("That image is over 10 MB. Please attach a smaller one.");
            restoreEditorFocus();
            return;
          }
          draft.setScreenshot(
            new File([file], safeScreenshotName(file.name), { type: file.type })
          );
          restoreEditorFocus();
        }}
      />
      <AudioButton
        id="feedback-audio-button"
        editor={editor}
        callbackHandler={insertDictation}
        defaultContent={editor?.getText()}
        toggleRecording={draft.setIsRecording}
        globalRecording={draft.isRecording}
        hasText={!isFeedbackTextEmpty(draft.text)}
        onProcessingChange={draft.setIsDictationProcessing}
        idleLabel="Dictate"
        ariaLabel="Start dictation"
        className="min-h-11 gap-1.5 rounded-sm px-2 text-text-light-gray hover:bg-hover-active hover:text-white-black"
        visualizerClassName="!mb-0"
      />
      {!draft.isDictating && draft.screenshot ? (
        <>
          <span className="text-text-light-gray">Screenshot attached</span>
          <button
            type="button"
            onClick={() => {
              draft.setScreenshot(null);
              window.requestAnimationFrame(restoreEditorFocus);
            }}
            className="ml-auto min-h-11 px-2 text-text-light-gray hover:text-white-black"
          >
            Remove
          </button>
        </>
      ) : !draft.isDictating ? (
        <button
          type="button"
          onClick={() => {
            shouldRestoreEditorFocus.current = true;
            fileInput.current?.click();
          }}
          className="min-h-11 px-2 text-text-light-gray hover:text-white-black"
        >
          Attach a screenshot
        </button>
      ) : null}
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-light-black-border-1 px-4 py-2.5 text-dense">
      <label className="flex cursor-pointer items-center gap-2 text-white-black">
        <input
          type="checkbox"
          checked={draft.notify}
          onChange={(event) => draft.setNotify(event.target.checked)}
          className="h-4 w-4 shrink-0 cursor-pointer accent-hypertasks-purple"
        />
        <span>Email me when this is fixed</span>
      </label>
      {currentUser?.email && (
        <span className="text-text-light-gray">{currentUser.email}</span>
      )}
    </div>
  </>
  );
};
