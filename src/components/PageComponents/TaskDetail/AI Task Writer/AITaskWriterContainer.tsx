import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AppSheet, SheetScroller } from "@/components/Modals/Sheets";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  extractTaskProperties,
  extractTitleAndDescription,
} from "@/utils/aiWriterUtils";
import { useAITaskWriterContext } from "@/lib/contexts/TaskDetail/AITaskWriterContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

// Components
import AILogo from "@/assets/AILogo.png";
import {
  ArrowUp,
  ChevronDown,
  Paperclip,
  PenLine,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import { SendArrow } from "@/components/Common/SendArrow";
import ConfirmModal from "@/components/Modals/Common Modals/ConfirmActionModal";
import AudioButton from "@/components/RTE/Components/AudioButton";
import AITaskWriterHeadline from "./AITaskWriterHeadline";
import AI_Options from "./AI_OPTIONS";
import ResponseNavigator from "./ResponseNavigator";
import AITaskWriterInputArea from "./AITaskWriterInputArea";

// Hooks
import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea";

// Constants & Types
import { IAITaskWriterContainerProps } from "@/models/AI_Task_writer_model";
import { KeyCodes } from "@/lib/constants/keyboard-handler";

// Styles
import styles from "@/styles/tiptap.module.scss";
import { cn } from "@/utils/undoActions/helperFuncs";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import AITaskWriterAttachments from "./AITaskWriterAttachments";
import Tooltip from "@/components/Common/Tooltip";
import { DIV_ID_CONSTANTS, MOBILE_TARGET } from "@/lib/configs/general.config";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { sanitizeAiHtml } from "@/utils/helperFunctions/sanitizeHtml";
import {
  buildTaskWriterPrompt,
  resolveTaskWriterSubmitPrompt,
} from "@/lib/ai/autoDescriptionSuggestion";
import {
  recordBoardMemorySignal,
  shouldLearnBoardMemoryFromAiMode,
} from "@/lib/ai/boardMemoryClient";

// Main Component
const AITaskWriterContainer: React.FC<
  IAITaskWriterContainerProps & {
    autoTrigger?: boolean;
    initialPrompt?: string;
    projectLabels?: import("@/models/model").ILabel[];
    projectSections?: { id?: number; section_title?: string }[];
    projectAssignees?: (
      | import("@/models/model").IUser
      | import("@/models/model").IAgent
    )[];
  }
> = ({
  id,
  AISaveHandler,
  EscapeHandler,
  returnTitleAndDescription,
  applyCreateTaskResult,
  mobileCreateTask,
  projectLabels,
  projectSections,
  projectAssignees,
  returnUserInputHandler,
  triggerAIWriterConfirm: triggerConfirmModal,
  createTask,
  toggleRecording,
  isRecording,
  dictationCoordinator,
  autoTrigger = false,
  initialPrompt = "",
  editMode,
  presentation = "overlay",
  onTurnOffTask,
  onTurnOffPermanently,
}) => {
  // Context
  const {
    aiMode,
    userPrompt,
    setUserPrompt,
    displayAiOptions,
    currentAiOption,
    responseHistory,
    currentResponseIndex,
    currentDisplayResponse,
    getCurrentResponseItem,
    isLoading,
    loadingText,
    sendAIRequest,
    retryLastRequest,
    hasError,
    navigateResponse,
    clearHistory,
    dropDownButtonAICallback,
    isUploadingAttachments,
    uploadProgress,
    triggerFileInput,
    isByokBlocked,
    projectId,

  } = useAITaskWriterContext();


  // Local state for modal and initialization
  const [showConfirmationModal, setShowConfirmationModal] = useState(triggerConfirmModal ?? false);
  const [isInitializing, setIsInitializing] = useState(autoTrigger);
  const [showTurnOffMenu, setShowTurnOffMenu] = useState(false);

  // Refs
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoTriggered = useRef(false);
  const hasSeededPrompt = useRef(false);
  const appliedCreateResponseRef = useRef("");
  const hasFocusedMobilePrompt = useRef(false);
  const mobilePromptVisibilityObserver = useRef<MutationObserver | null>(null);
  const mobilePromptCanFocus = useRef(true);
  mobilePromptCanFocus.current = !isLoading && !currentDisplayResponse;

  // Hooks
  const isApple = useDeviceContext();
  const isMobile = useContext(MobileViewContext);
  const isMobileCreateFlow = Boolean(isMobile && createTask && mobileCreateTask);
  const writerViewport = useMobileVisualViewport(isMobile);
  const mobilePromptMaxHeight =
    isMobile && writerViewport
      ? Math.max(
          96,
          Math.min(240, Math.floor(writerViewport.visibleHeight * 0.32)),
        )
      : undefined;

  useAutosizeTextArea(
    textAreaRef.current,
    userPrompt,
    {
      editMode,
      createTask,
      isMobile,
      maxHeightPx: mobilePromptMaxHeight,
    },
    mobilePromptMaxHeight,
  );

  // Native autofocus is unreliable when the textarea mounts inside an animated
  // sheet. Focus during the layout phase while the opening tap still owns user
  // activation, then put the caret at the end of any seeded prompt.
  useLayoutEffect(() => {
    const isWaitingForSeededPrompt =
      !autoTrigger && Boolean(initialPrompt) && !userPrompt;
    if (
      !isMobile ||
      isLoading ||
      currentDisplayResponse ||
      isWaitingForSeededPrompt ||
      hasFocusedMobilePrompt.current
    ) {
      return;
    }

    const prompt = textAreaRef.current;
    if (!prompt) return;
    prompt.focus({ preventScroll: true });
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);

    // The create-task shell also manages focus when its nested sheet opens.
    // Reconcile once after all opening effects have run so it cannot leave the
    // caret behind in the task title (HTPR-5331).
    const focusFrame = window.requestAnimationFrame(() => {
      if (!prompt.isConnected) return;
      prompt.focus({ preventScroll: true });
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      hasFocusedMobilePrompt.current = true;
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [
    autoTrigger,
    currentDisplayResponse,
    initialPrompt,
    isLoading,
    isMobile,
    userPrompt,
  ]);

  // When the software keyboard changes visualViewport, keep the active prompt
  // and its toolbar inside the newly visible portion of the sheet.
  useEffect(() => {
    const prompt = textAreaRef.current;
    if (
      !isMobile ||
      !prompt ||
      document.activeElement !== prompt ||
      !writerViewport
    ) {
      return;
    }
    prompt.scrollIntoView({ block: "nearest" });
  }, [
    isMobile,
    writerViewport?.bottomInset,
    writerViewport?.visibleHeight,
  ]);

  useEffect(
    () => () => mobilePromptVisibilityObserver.current?.disconnect(),
    [],
  );

  // Core Functions
  const sendInitialPrompt = useCallback(
    (loadingMessage: string) => {
      if (!initialPrompt) return;
      const taskTitle = document.getElementById(
        DIV_ID_CONSTANTS.titleInputModal,
      )?.innerHTML;
      void sendAIRequest(
        buildTaskWriterPrompt(initialPrompt, taskTitle),
        loadingMessage,
        presentation === "description-suggestion"
          ? "auto-description"
          : "manual",
      );
    },
    [initialPrompt, presentation, sendAIRequest],
  );

  const onClickHandler = useCallback(() => {
    if (isByokBlocked) return;
    const promptToUse = resolveTaskWriterSubmitPrompt(
      autoTrigger,
      presentation,
      initialPrompt,
      userPrompt,
    );
    if (!promptToUse.trim()) return;

    // Don't send if attachments are still uploading
    if (isUploadingAttachments) {
      console.log("Cannot send while attachments are uploading...", { uploadProgress });
      return;
    }

    const taskTitle = document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.innerHTML;

    sendAIRequest(
      buildTaskWriterPrompt(promptToUse, taskTitle),
      "Thinking...",
    );
  }, [
    autoTrigger,
    initialPrompt,
    isByokBlocked,
    presentation,
    userPrompt,
    sendAIRequest,
    isUploadingAttachments,
    uploadProgress,
  ]);

  const regenerateDescriptionSuggestion = useCallback(() => {
    if (isUploadingAttachments) {
      console.log("Cannot send while attachments are uploading...", { uploadProgress });
      return;
    }
    sendInitialPrompt("Drafting a description from your title...");
  }, [isUploadingAttachments, sendInitialPrompt, uploadProgress]);

  // A completed mobile response leaves the composer open for a new request.
  // Unlike auto-trigger's first request, this always sends exactly what the
  // user has edited in that composer.
  const handleMobileResend = useCallback(() => {
    if (isLoading || isByokBlocked || isUploadingAttachments || !userPrompt.trim()) return;

    const taskTitle = document.getElementById(DIV_ID_CONSTANTS.titleInputModal)?.innerHTML;
    sendAIRequest(
      buildTaskWriterPrompt(userPrompt, taskTitle),
      "Thinking...",
    );
  }, [isLoading, isByokBlocked, isUploadingAttachments, userPrompt, sendAIRequest]);

  // Without autoTrigger an initialPrompt is a suggestion: type it into the box
  // and let the user press send. Only seeds an untouched composer.
  useEffect(() => {
    if (autoTrigger || !initialPrompt || hasSeededPrompt.current) return;
    hasSeededPrompt.current = true;
    setUserPrompt((prev: string) => (prev.trim() ? prev : initialPrompt));
  }, [autoTrigger, initialPrompt, setUserPrompt]);

  // Auto-trigger on mount if requested
  useEffect(() => {
    if (autoTrigger && !hasAutoTriggered.current && initialPrompt) {
      hasAutoTriggered.current = true;
      setIsInitializing(false);
      sendInitialPrompt("Thinking...");
    }
  }, [autoTrigger, initialPrompt, sendInitialPrompt]);

  // Callback Handlers
  const handleAIOptionCallback = useCallback(
    async (
      optionPrompt:
        | string
        | "Accept"
        | "AcceptDescOnly"
        | "AcceptDescTitle"
        | "AcceptAll",
      loadingTextParam = ""
    ) => {
      const currentItem = getCurrentResponseItem();
      switch (optionPrompt) {
        case "Accept":
          AISaveHandler(currentDisplayResponse, currentItem?.attachments);
          clearHistory();
          break;
        case "AcceptDescOnly": {
          const descResult = extractTitleAndDescription(currentDisplayResponse);
          AISaveHandler(descResult.description, currentItem?.attachments);
          clearHistory();
          break;
        }
        case "AcceptDescTitle": {
          const result = extractTitleAndDescription(currentDisplayResponse);
          AISaveHandler(result.description, currentItem?.attachments);
          returnTitleAndDescription?.(result.title ?? "", result.description);
          clearHistory();
          break;
        }
        case "AcceptAll": {
          const result = extractTaskProperties(
            currentDisplayResponse,
            projectLabels,
            projectSections,
            projectAssignees,
          );
          AISaveHandler(result.description, currentItem?.attachments);
          returnTitleAndDescription?.(result.title ?? "", result.description, {
            priority: result.priority,
            estimate: result.estimate,
            tags: result.tags,
            status: result.status,
            assignees: result.assignees,
            dueDate: result.dueDate,
            startDate: result.startDate,
          });
          clearHistory();
          break;
        }
        default:
          if (shouldLearnBoardMemoryFromAiMode(aiMode)) {
            void recordBoardMemorySignal(projectId, {
              type: "task_writer_correction",
              originalText: currentDisplayResponse,
              correctionText: optionPrompt,
            });
          }
          const newPrompt = `${optionPrompt}\n${currentDisplayResponse}`;
          sendAIRequest(newPrompt, loadingTextParam);
      }
    },
    [
      AISaveHandler,
      aiMode,
      currentDisplayResponse,
      getCurrentResponseItem,
      clearHistory,
      returnTitleAndDescription,
      sendAIRequest,
      projectId,
      projectLabels,
      projectSections,
      projectAssignees,
    ]
  );

  useEffect(() => {
    if (
      !isMobileCreateFlow ||
      !applyCreateTaskResult ||
      isLoading ||
      hasError ||
      !currentDisplayResponse
    ) {
      return;
    }

    const currentResponseItem = getCurrentResponseItem();
    // The provider adds a completed response to history in its own effect. Wait
    // for that item so automatic create also carries the response attachments.
    if (
      !currentResponseItem ||
      appliedCreateResponseRef.current === currentResponseItem.id
    ) {
      return;
    }

    appliedCreateResponseRef.current = currentResponseItem.id;
    const result = extractTaskProperties(
      currentDisplayResponse,
      projectLabels,
      projectSections,
      projectAssignees,
    );
    applyCreateTaskResult(
      result,
      currentResponseItem.attachments,
      projectId ?? undefined,
    );
    // Mobile create has no result sheet. Whether the response was applied or
    // rejected as stale, consume it and return to the form.
    clearHistory();
  }, [
    applyCreateTaskResult,
    clearHistory,
    currentDisplayResponse,
    getCurrentResponseItem,
    hasError,
    isLoading,
    isMobileCreateFlow,
    projectAssignees,
    projectId,
    projectLabels,
    projectSections,
  ]);

  // Event Handlers
  const handleInputKeydown = useCallback(
    (e: React.KeyboardEvent) => {
      const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

      if (isLoading || currentDisplayResponse || isRecording) return;

      // Audio shortcuts
      if ((e.shiftKey && cmdControl && e.keyCode === KeyCodes.D) || (e.altKey && e.keyCode === KeyCodes.V)) {
        e.preventDefault();
        document.getElementById("ai-writer-audio-button")?.click();
      }

      if ((e.shiftKey && cmdControl && e.keyCode === KeyCodes.F)) {
        e.preventDefault();
        document.getElementById("ai-writer-audio-button-improve")?.click();
      }

      if (e.shiftKey) return;

      // Enter to submit
      if (e.keyCode === KeyCodes.ENTER && !showConfirmationModal) {
        e.preventDefault();
        if (isByokBlocked) return;
        onClickHandler();
        return;
      }

    },
    [isApple, isLoading, isByokBlocked, currentDisplayResponse, onClickHandler, isRecording, showConfirmationModal]
  );

  const handleEscape = useCallback(() => {
    if (
      presentation !== "description-suggestion" &&
      currentDisplayResponse.length > 0
    ) {
      setShowConfirmationModal(true);
    } else {
      setTimeout(EscapeHandler, 0);
    }
  }, [currentDisplayResponse, EscapeHandler, presentation]);

  // Modal Handlers
  const onConfirmDiscard = useCallback(() => {
    setShowConfirmationModal(false);
    setTimeout(EscapeHandler, 0);
  }, [EscapeHandler]);

  const onCancelDiscard = useCallback(() => {
    setShowConfirmationModal(false);
  }, []);

  // Handle Accept from Navigator
  const handleAccept = useCallback(() => {
    const currentItem = getCurrentResponseItem();
    const acceptedContent =
      presentation === "description-suggestion"
        ? extractTitleAndDescription(currentDisplayResponse).description
        : currentDisplayResponse;
    AISaveHandler(
      presentation === "description-suggestion"
        ? sanitizeAiHtml(acceptedContent)
        : acceptedContent,
      currentItem?.attachments,
    );
    clearHistory();
    setTimeout(EscapeHandler, 0);
  }, [
    AISaveHandler,
    currentDisplayResponse,
    getCurrentResponseItem,
    clearHistory,
    EscapeHandler,
    presentation,
  ]);

  const headlineEl = (
    <AITaskWriterHeadline
      onCloseHandler={handleEscape}
      currentOptions={displayAiOptions}
      dropdownCallback={dropDownButtonAICallback}
      selectedAi={currentAiOption}
      defaultMode={aiMode}
      handleAccept={handleAccept}
    />
  );

  const responseBodyEl = currentDisplayResponse ? (
    <>
      <span
        id="Ai-response-container"
        dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(currentDisplayResponse) }}
        className={`
          ${styles.ProseMirror} ${styles.editorContainer}  
          my-2 
          transition-opacity duration-150 ease-in-out`}
      />
      <hr className="w-full text-white-black my-1 h-[0.2px] opacity-10" />
      {getCurrentResponseItem()?.attachments?.length ? (
        <div className="bg-comment-description rounded-md p-2">
          <AITaskWriterAttachments
            attachments={getCurrentResponseItem()?.attachments || []}
            isInHistory={true}
          />
        </div>
      ) : null}
    </>
  ) : null;

  let mobileWriterPlaceholder: string | undefined;
  if (isMobileCreateFlow) {
    mobileWriterPlaceholder = mobileCreateTask?.formSummary
      ? "Say what is missing, or just hit the mic…"
      : "Tap to type, or hit the mic and just talk…";
  }

  const inputAndToolbarEl = (
    <>
      <AITaskWriterInputArea
        isLoading={isLoading}
        autoTrigger={autoTrigger}
        currentDisplayResponse={currentDisplayResponse}
        loadingText={loadingText}
        userPrompt={userPrompt}
        setUserPrompt={setUserPrompt}
        returnUserInputHandler={returnUserInputHandler}
        handleInputKeydown={handleInputKeydown}
        onClickHandler={onClickHandler}
        textAreaRef={textAreaRef}
        aiMode={aiMode}
        isMobile={isMobile}
        toggleRecording={toggleRecording}
        isUploadingAttachments={isUploadingAttachments}
        uploadProgress={uploadProgress}
        placeholder={mobileWriterPlaceholder}
      />
      <hr className="w-full text-white-black my-1 h-[0.2px] opacity-10" />
      <div className="flex justify-between items-center w-full">
        {/* On a phone these were 20px glyphs pinned to the extreme bottom-right,
            the hardest corner to reach one-handed. 44px targets, and the row
            starts from the left instead (HTPR-5098). Desktop is unchanged. */}
        {/* HTPR-5331 now centers that preserved 44px row in the thumb zone. */}
        <div
          className={cn(
            "flex ml-auto gap-1 w-full items-center self-end",
            isMobile ? "justify-start gap-1" : "justify-end"
          )}
        >
          {!isLoading && (
            <div className="group relative">
              <button
                type="button"
                onClick={triggerFileInput}
                className={cn(
                  "relative group flex-shrink-0 py-2 text-icon-dark-gray hover:text-white-black transition-colors duration-200 ease-in-out rounded-md",
                  isMobile ? MOBILE_TARGET : "self-start"
                )}
                title="Attach files (Images, PDF, DOCX - Max 2MB each)"
              >
                <Paperclip size={20} strokeWidth={1.75} />
                <Tooltip
                  left={-80}
                  bottom={45}
                  text="Attach files"
                  keyCombination={[isApple ? "CMD" : "CTRL", "⇧", "A"]}
                />
              </button>
            </div>
          )}
          {toggleRecording && !isLoading && (
            <AudioButton
              toggleRecording={toggleRecording}
              callbackHandler={text => setUserPrompt((prev: string) => prev + text)}
              defaultContent={userPrompt}
              editor={null}
              id="ai-writer-audio-button"
              hasText={Boolean(userPrompt.trim())}
              dictationCoordinator={dictationCoordinator}
              className={isMobile ? MOBILE_TARGET : undefined}
              // Empty composer: the filled mic is the primary and sits far
              // right (clip - spacer - mic, per the approved wireframe). Once
              // text exists Send takes that slot and the mic joins the clip on
              // the left. ml-auto rides the .audio-recorder root - the flex
              // child - so the one mounted instance moves without remounting.
              wrapperClassName={
                isMobile && !userPrompt.trim() ? "ml-auto" : undefined
              }
            />
          )}
          {hasError && !isLoading && (
            <button
              type="button"
              onClick={retryLastRequest}
              className={cn(
                "relative group flex-shrink-0 py-2 text-icon-dark-gray hover:text-white-black transition-colors duration-200 ease-in-out rounded-md",
                isMobile ? MOBILE_TARGET : "self-start"
              )}
              aria-label="Retry last request"
              title="Retry last request"
            >
              <RotateCw size={20} strokeWidth={1.75} />
            </button>
          )}
          {!isLoading && (!isMobile || Boolean(userPrompt.trim())) && (
            <div
              // The tap target lives on the wrapper so the whole 44px square
              // sends, not just the 18px glyph inside it. On mobile it appears
              // only once the prompt has text; empty composers show just attach
              // and the filled mic, per the approved wireframe (HTPR-5517).
              onClick={onClickHandler}
              role={isMobile ? "button" : undefined}
              tabIndex={isMobile ? 0 : undefined}
              aria-label={isMobile ? "Send prompt" : undefined}
              aria-disabled={
                isMobile ? isByokBlocked || isUploadingAttachments : undefined
              }
              onKeyDown={(event) => {
                if (
                  !isMobile ||
                  (event.key !== "Enter" && event.key !== " ")
                ) {
                  return;
                }
                event.preventDefault();
                onClickHandler();
              }}
              className={cn(
                "relative group",
                isMobile &&
                  "ml-auto flex h-11 w-12 cursor-pointer items-center justify-center rounded-[4px] bg-white-black text-white-black-inverted"
              )}
            >
              <span
                className={`transition-opacity duration-200 ease-in-out ${
                  isByokBlocked || isUploadingAttachments
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer"
                }`}
              >
                <SendArrow size={18} />
              </span>
              <Tooltip
                text={
                  isByokBlocked
                    ? "Enable API keys first"
                    : isUploadingAttachments
                    ? `Uploading ${uploadProgress.uploaded}/${uploadProgress.total} attachments…`
                    : "Send message"
                }
                keyCombination={isByokBlocked || isUploadingAttachments ? [] : ["ENTER"]}
                left={-160}
                bottom={25}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );

  const aiOptionsEl =
    !isMobileCreateFlow && !isLoading && currentDisplayResponse ? (
      <div className="animate-fadeIn mt-1">
        <AI_Options
          mode={aiMode}
          inputValue={userPrompt}
          key={`user-prompt-${userPrompt}`}
          callback={handleAIOptionCallback}
          presentation={isMobile ? "mobileActionSheet" : "inlineMenu"}
          onResend={isMobile ? handleMobileResend : undefined}
          isResendDisabled={
            isLoading || isByokBlocked || isUploadingAttachments || !userPrompt.trim()
          }
        />
      </div>
    ) : null;

  const mobileCreateHeaderEl = mobileCreateTask ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-subheading font-semibold text-hypertasks-ai-purple">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <PenLine size={22} strokeWidth={1.75} />
            <Sparkles
              size={10}
              strokeWidth={1.75}
              className="absolute -right-1 -top-0.5"
            />
          </span>
          <span>AI task writer</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={mobileCreateTask.onClassicForm}
            className="min-h-11 rounded-sm px-3 text-content font-semibold text-text-light-gray hover:bg-hover-active hover:text-white-black"
          >
            Classic form
          </button>
          <button
            type="button"
            onClick={mobileCreateTask.onClose}
            aria-label="Close new task"
            className={`${MOBILE_TARGET} rounded-sm text-text-light-gray hover:bg-hover-active hover:text-white-black`}
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <h2 className="mt-5 text-heading font-semibold leading-tight text-white-black">
        {mobileCreateTask.formSummary
          ? "What should the writer add or change?"
          : "What is this task about?"}
      </h2>
      <p className="mt-2 text-content leading-5 text-text-light-gray">
        Say it like you’d explain it to a colleague. The more context, the better
        the task.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={mobileCreateTask.onBoardClick}
          className="min-h-11 rounded-sm bg-cardBackground px-3 text-content text-white-black"
        >
          <span className="text-text-light-gray">Board:</span>{" "}
          <strong>{mobileCreateTask.boardLabel}</strong>
        </button>
        <button
          type="button"
          onClick={mobileCreateTask.onPriorityClick}
          className="min-h-11 rounded-sm bg-cardBackground px-3 text-content text-white-black"
        >
          Priority: {mobileCreateTask.priorityLabel}
        </button>
        <button
          type="button"
          onClick={mobileCreateTask.onAssigneeClick}
          className="min-h-11 rounded-sm bg-cardBackground px-3 text-content text-white-black"
        >
          Assignee: {mobileCreateTask.assigneeLabel}
        </button>
      </div>
      {mobileCreateTask.formSummary && (
        <div className="mt-4 rounded-[5px] bg-cardBackground px-3 py-3 text-content leading-5 text-white-black">
          <p className="text-micro font-semibold uppercase tracking-wider text-text-light-gray">
            Already in the form · the writer keeps this and fills in the rest
          </p>
          {mobileCreateTask.formSummary.title && (
            <p className="mt-2 font-semibold">
              {mobileCreateTask.formSummary.title}
            </p>
          )}
          {mobileCreateTask.formSummary.description && (
            <p className="mt-1 line-clamp-3 text-text-light-gray">
              {mobileCreateTask.formSummary.description}
            </p>
          )}
          {mobileCreateTask.formSummary.properties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {mobileCreateTask.formSummary.properties.map((property) => (
                <span key={property} className="text-meta text-text-light-gray">
                  {property}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  ) : null;

  useEffect(() => {
    if (!isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRecording && !showConfirmationModal) {
        e.preventDefault();
        e.stopPropagation();
        handleEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, isRecording, showConfirmationModal, handleEscape]);

  // Don't render if still initializing
  if (isInitializing) {
    return null;
  }

  // Visible controls are the owner-approved HTPR-5890 flow:
  // https://app.hypertask.ai/page/cmtiiril300000aht4ztpr236
  if (presentation === "description-suggestion" && !isMobile) {
    return (
      <div
        id={id}
        className="mt-3 flex w-full flex-col gap-2 text-white-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{headlineEl}</div>
          <span className="text-micro text-text-light-gray">
            Draft from your title
          </span>
        </div>
        <div className="rounded-[5px] border-l border-l-hypertasks-ai-purple bg-comment-description px-4 py-3 shadow-md">
          {currentDisplayResponse ? responseBodyEl : inputAndToolbarEl}
        </div>
        {currentDisplayResponse && !isLoading && !hasError ? (
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={handleAccept}
              className="flex items-center gap-2 rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense font-semibold text-primary-foreground"
            >
              <ArrowUp size={16} strokeWidth={1.75} />
              Take over description
            </button>
            <button
              type="button"
              onClick={regenerateDescriptionSuggestion}
              className="flex items-center gap-2 rounded-[4px] bg-cardBackground px-3 py-2 text-dense font-semibold"
            >
              <RotateCw size={16} strokeWidth={1.75} />
              Regenerate
            </button>
            <div className="ml-auto">
              <button
                type="button"
                aria-expanded={showTurnOffMenu}
                onClick={() => setShowTurnOffMenu((current) => !current)}
                className="flex items-center gap-1 px-2 py-2 text-dense text-text-light-gray"
              >
                Turn off <ChevronDown size={15} strokeWidth={1.75} />
              </button>
              {showTurnOffMenu ? (
                <div className="absolute right-0 top-full z-[6000] mt-1 w-60 rounded-[4px] bg-modalBackground p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={onTurnOffTask}
                    className="w-full rounded-[4px] px-3 py-2 text-left hover:bg-active-modal-element"
                  >
                    <span className="block text-dense">Not for this task</span>
                    <span className="block text-micro text-text-light-gray">
                      Hide this draft on this task
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onTurnOffPermanently}
                    className="w-full rounded-[4px] px-3 py-2 text-left hover:bg-active-modal-element"
                  >
                    <span className="block text-dense">Never suggest descriptions</span>
                    <span className="block text-micro text-text-light-gray">
                      Re-enable in Task page settings
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {currentDisplayResponse && !isLoading ? (
          <div className="rounded-[4px] bg-comment-description px-3 py-1">
            {inputAndToolbarEl}
          </div>
        ) : null}
      </div>
    );
  }

  // Mobile: full bottom sheet (like task Summary) — response scrolls; Accept / actions stay in view
  if (isMobile) {
    return (
      <>
        <AppSheet
          id={id}
          isOpen={true}
          onClose={
            isMobileCreateFlow ? mobileCreateTask!.onClose : handleEscape
          }
          // Reduced-motion sheets skip their opening animation and therefore
          // do not emit onOpenEnd; onOpenStart is their final focus handoff.
          onOpenStart={() => {
            const prompt = textAreaRef.current;
            if (isLoading || currentDisplayResponse || !prompt) return;
            prompt.focus({ preventScroll: true });
            prompt.setSelectionRange(prompt.value.length, prompt.value.length);
            hasFocusedMobilePrompt.current = true;

            const sheet = prompt.closest('[role="dialog"]');
            if (!sheet) return;
            if (getComputedStyle(sheet).visibility !== "hidden") {
              // With reduced motion the sheet can be visible before this
              // passive effect runs. Handoff after the current React effect
              // flush so the create-task title effect cannot reclaim focus.
              queueMicrotask(() => {
                if (!mobilePromptCanFocus.current || !prompt.isConnected) return;
                prompt.focus({ preventScroll: true });
                prompt.setSelectionRange(prompt.value.length, prompt.value.length);
                hasFocusedMobilePrompt.current = true;
              });
              return;
            }

            mobilePromptVisibilityObserver.current?.disconnect();
            const observer = new MutationObserver(() => {
              if (
                !mobilePromptCanFocus.current ||
                !prompt.isConnected
              ) {
                observer.disconnect();
                if (mobilePromptVisibilityObserver.current === observer) {
                  mobilePromptVisibilityObserver.current = null;
                }
                return;
              }
              if (getComputedStyle(sheet).visibility === "hidden") return;
              prompt.focus({ preventScroll: true });
              prompt.setSelectionRange(prompt.value.length, prompt.value.length);
              hasFocusedMobilePrompt.current = true;
              observer.disconnect();
              if (mobilePromptVisibilityObserver.current === observer) {
                mobilePromptVisibilityObserver.current = null;
              }
            });
            observer.observe(sheet, {
              attributes: true,
              attributeFilter: ["style", "class"],
            });
            mobilePromptVisibilityObserver.current = observer;
          }}
          onOpenEnd={() => {
            mobilePromptVisibilityObserver.current?.disconnect();
            mobilePromptVisibilityObserver.current = null;
            const prompt = textAreaRef.current;
            if (isLoading || currentDisplayResponse || !prompt) return;
            prompt.focus({ preventScroll: true });
            prompt.setSelectionRange(prompt.value.length, prompt.value.length);
            hasFocusedMobilePrompt.current = true;
          }}
          detent="full-height"
          sheetClassName="!z-[12000]"
          // dvh tracks the LAYOUT viewport, which does not shrink when the
          // on-screen keyboard opens, so the keyboard slid up over the writer's
          // own controls (HTPR-5147). visualViewport does shrink: sit the sheet
          // on top of the keyboard and cap it to what is actually visible, the
          // same way MobileBottomSheet already does.
          containerStyle={
            writerViewport
              ? {
                  bottom: writerViewport.bottomInset,
                  maxHeight: `${writerViewport.visibleHeight}px`,
                }
              : undefined
          }
          disableScrollLocking
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          ariaLabel="AI task writer"
          panelClassName={cn(
            "ai-task-writer-panel text-white-black",
            styles.hellow,
            isMobileCreateFlow
              ? "rounded-none bg-pageBackground shadow-none"
              : "rounded-t-[5px] border-x border-t border-thin border-hypertasks-ai-purple/70 bg-comment-description shadow-customshadow-1",
          )}
          bodyClassName={cn(
            "flex flex-col overflow-hidden pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            isMobileCreateFlow ? "px-4 pt-3" : "px-2",
            writerViewport ? "max-h-full" : "max-h-[min(88dvh,920px)]",
          )}
        >
          <div className="flex-shrink-0 pb-1 pt-2">
            {isMobileCreateFlow ? mobileCreateHeaderEl : headlineEl}
          </div>
          {!isMobileCreateFlow && currentDisplayResponse ? (
            <SheetScroller
              draggableAt="top"
              className="flex-1 min-h-0 scrollbar-thin scrollbar-track-white-black-inverted scrollbar-thumb-white-black"
            >
              <div className="animate-fadeIn pr-1">{responseBodyEl}</div>
            </SheetScroller>
          ) : (
            <div className="flex-1 min-h-0" />
          )}
          <div
            data-mobile-task-writer-composer
            className="flex-shrink-0 flex flex-col gap-0 rounded-lg bg-newcomment-well px-2 pb-1 pt-2 mt-1"
          >
            {inputAndToolbarEl}
            {aiOptionsEl}
          </div>
        </AppSheet>

        {showConfirmationModal && (
          <ConfirmModal
            header="Discard AI Response?"
            content="The AI Response will not be saved"
            confirmButtonContent="Discard"
            onConfirm={onConfirmDiscard}
            onCancel={onCancelDiscard}
            onTaskPage={true}
            customClassName="sm:min-w-[500px] xs:max-h-[600px] z-[90000000] relative"
            compact="my-[-15px]"
          />
        )}

        <style jsx>{`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .animate-fadeIn {
            animation: fadeIn 0.3s ease-in-out;
          }
        `}</style>
      </>
    );
  }

  // Render — desktop / non-mobile overlay
  return (
    <>
      <div
        id={id}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape" && !isRecording && !showConfirmationModal) {
            e.preventDefault();
            // Stop the ESC from reaching ConfirmModal's document listener,
            // which would instantly cancel the modal this press just opened
            e.stopPropagation();
            handleEscape();
          }
        }}
        className={`text-white-black z-[5000] absolute w-full ${currentDisplayResponse ? "top-0" : "bottom-0"}`}
      >
        <div className="min-h-full">
          <div
            className={`ai-task-writer-panel p-2 rounded bg-comment-description shadow-customshadow-1 border-thin
              ${styles.hellow} border-hypertasks-ai-purple/70 flex gap-2 flex-col 
              transition-opacity duration-150 ease-in-out`}
          >
            {headlineEl}
            {currentDisplayResponse && (
              <div className="animate-fadeIn max-h-[40svh] overflow-y-auto scrollbar-thin scrollbar-track-white-black-inverted scrollbar-thumb-white-black">
                {responseBodyEl}
              </div>
            )}
            {inputAndToolbarEl}
          </div>
          {aiOptionsEl}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmationModal && (
        <ConfirmModal
          header="Discard AI Response?"
          content="The AI Response will not be saved"
          confirmButtonContent="Discard"
          onConfirm={onConfirmDiscard}
          onCancel={onCancelDiscard}
          onTaskPage={true}
          customClassName="sm:min-w-[500px] xs:max-h-[600px] z-[90000000] relative"
          compact="my-[-15px]"
        />
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-in-out;
        }
      `}</style>
    </>
  );
};

export default AITaskWriterContainer;

// Also export the version with provider for easier usage
export { default as AITaskWriterWithProvider } from './AITaskWriterWithProvider';
