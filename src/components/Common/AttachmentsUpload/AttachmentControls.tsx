import React, { useEffect, useRef } from "react";
import { Check, Paperclip, PencilSparkles, Trash2 } from "lucide-react";
import Tooltip from "../Tooltip";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { IStatus, RedirectMode } from "@/models/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import type { Editor } from "@tiptap/react";
import { TSendBackAttachmentButton, TSendBackButtonParam } from "@/models/CreateTaskModalModels/model";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { SendArrow } from "@/components/Common/SendArrow";
import type { DictationCoordinator } from "@/lib/dictationCoordinator";



// ================================ MOBILE save button
export interface IPropsSaveButtonMobile {
  sendOnClick: any;
  mode: RedirectMode;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  handleDiscardDrafts: () => void;
}


export interface IMobileBottomBar {
  hasText?: boolean;
  handleAttachmentClick: (e?: any) => void;
  sendOnClick: any;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  isRecording?: boolean;
  isProcessing?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  dictationCoordinator?: DictationCoordinator;
  toggleAiTaskWriter?: () => void;
  isAiTaskWriterOpen?: boolean;
  descriptionFirst?: boolean;
}


export const ActionButton = React.forwardRef<HTMLSpanElement, any>(({ label, onClick }, ref) => {
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      className={cn(
        MOBILE_TARGET,
        "rounded-sm px-2 border-thin border-icon-dark-gray cursor-pointer whitespace-nowrap"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick && onClick(e);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick && onClick(e);
      }}
    >
      {label}
    </span>
  );
});
ActionButton.displayName = "ActionButton";


export const MobileBottomBar: React.FC<IMobileBottomBar> = ({
  hasText,
  handleAttachmentClick,
  sendOnClick,
  audioTiptapCallback,
  toggleRecording,
  editor,
  isRecording,
  isProcessing,
  onProcessingChange,
  dictationCoordinator,
  toggleAiTaskWriter,
  isAiTaskWriterOpen,
  descriptionFirst = false,
}) => {
  const saveRef = useRef<HTMLSpanElement>(null);
  const wasDictating = useRef(false);
  const isDictating = Boolean(isRecording || isProcessing);
  let recorderWrapperClassName = hasText ? "order-2" : "order-4";
  if (isDictating) recorderWrapperClassName = "flex min-h-[62px] w-full items-center";
  const barRef = useRef<HTMLDivElement>(null);
  const wasAiTaskWriterOpen = useRef(false);
  // Dictation is the likeliest way a task gets written on a phone, and Save is
  // what you want next. The row scrolls, so Save can be sitting past the right
  // edge exactly when dictation finishes (HTPR-5147). Bring it back into view.
  useEffect(() => {
    if (wasDictating.current && !isDictating) {
      saveRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    wasDictating.current = isDictating;
  }, [isDictating]);

  // Returning from Task Writer focuses the editor and commonly reopens the
  // keyboard. Restore the action bar vertically; primary controls no longer
  // depend on the row's previous horizontal scroll position.
  useEffect(() => {
    if (wasAiTaskWriterOpen.current && !isAiTaskWriterOpen) {
      barRef.current?.scrollIntoView({ block: "nearest" });
    }
    wasAiTaskWriterOpen.current = Boolean(isAiTaskWriterOpen);
  }, [isAiTaskWriterOpen]);

  return (
    // HTPR-5332 supersedes only the scroll dependency: AI, dictation, the
    // full-width waveform, and Save-after-dictation behavior below stay intact.
    // w-full + min-w-0: the row already asked to scroll, but a flex child sizes to
    // its content unless it is bounded, so the actions ran off the screen edge
    // instead (HTPR-5040).
    <div ref={barRef} data-mobile-new-task-actions className="relative flex w-full min-w-0 items-center gap-1.5 overflow-visible pb-[env(safe-area-inset-bottom)] scroll-mb-[calc(env(safe-area-inset-bottom)_+_0.5rem)] text-meta font-semibold text-icon-hover-gray">
      {/* The AI writer used to be a 16px "ai" link floating in the description
          card corner. It belongs where the other actions live, and first: the row
          scrolls, so the control reached for most is the one never scrolled to
          (HTPR-5098). */}
      {!isDictating && (
        <button
          type="button"
          aria-label="Attach files"
          onClick={(e) => {
            e.stopPropagation();
            handleAttachmentClick();
          }}
          className={cn(
            MOBILE_TARGET,
            "order-1 shrink-0 rounded-sm text-icon-dark-gray hover:text-white-black",
          )}
        >
          <Paperclip size={20} strokeWidth={1.75} />
        </button>
      )}
      {/* Dictation is how tasks get created on a phone: it went missing when this
          bar stopped reusing the desktop row. Keep this instance mounted while
          recording so the first tap's MediaRecorder is not discarded (#2666). */}
      {toggleRecording && audioTiptapCallback && (
        <AudioButton
          key="new-task-dictation"
          callbackHandler={audioTiptapCallback}
          editor={editor}
          id="create-task-modal-audio-button"
          toggleRecording={toggleRecording}
          globalRecording={isRecording}
          hasText={hasText}
          onProcessingChange={onProcessingChange}
          dictationCoordinator={dictationCoordinator}
          ariaLabel="Dictate description"
          mobilePresentation="prominent"
          // Canonical exception: openwiki/style-guide.md approves the white buttons for
          // https://app.hypertask.ai/detail/project-15/5995.
          mobilePrimaryTone="default"
          className={isDictating ? undefined : MOBILE_TARGET}
          // order lives on the wrapper: only the .audio-recorder root is a
          // direct child of this flex row, so order on className is a no-op.
          wrapperClassName={recorderWrapperClassName}
          visualizerClassName="!mb-0 w-full"
        />
      )}
      {!isDictating && !descriptionFirst && toggleAiTaskWriter && (
        <button
          type="button"
          id="create-task-modal-ai-writer-button"
          aria-label="Write with AI"
          onClick={(e) => {
            e.stopPropagation();
            toggleAiTaskWriter();
          }}
          className={cn(
            MOBILE_TARGET,
            "order-3 ml-auto inline-flex min-w-0 shrink-0 items-center justify-center rounded-sm text-hypertasks-ai-purple"
          )}
        >
          <PencilSparkles size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {/* Dictation is how tasks get created on a phone: it went missing when this
          bar stopped reusing the desktop row. Keep this instance mounted while
          recording so the first tap's MediaRecorder is not discarded. */}
      {!isDictating && !descriptionFirst && hasText && (
        <div
          data-mobile-primary-save
          className="order-6 shrink-0 [&>span]:!border-transparent [&>span]:!bg-shadcn-primary [&>span]:!text-primary-foreground"
        >
          <ActionButton
            ref={saveRef}
            label="Save"
            onClick={() => sendOnClick && sendOnClick("Save")}
          />
        </div>
      )}
      {!isDictating && descriptionFirst && hasText && (
        <div className="order-6 ml-auto flex shrink-0 items-center gap-2">
          <div className="[&>span]:!border-transparent [&>span]:!text-icon-dark-gray">
            <ActionButton
              label="Save"
              onClick={() => sendOnClick && sendOnClick("Save")}
            />
          </div>
          <div
            data-mobile-primary-save
            className="[&>span]:!border-transparent [&>span]:!bg-shadcn-primary [&>span]:!px-3 [&>span]:!text-primary-foreground"
          >
            <ActionButton
              ref={saveRef}
              label="Save with task writer"
              onClick={toggleAiTaskWriter}
            />
          </div>
        </div>
      )}

    </div>
  );
};

// ====================================
export const SaveButtonMobile: React.FC<IPropsSaveButtonMobile> = ({
  sendOnClick,
  mode,
  audioDefaultContent,
  audioTiptapCallback,
  toggleRecording,
  handleDiscardDrafts,
  editor,
}) => {
  return (
    <span className="text-content text-icon-dark-gray font-semibold">
      {mode === "create-comment" ? (
        <button
          aria-label="Send comment"
          className="flex h-11 w-12 touch-manipulation items-center justify-center rounded-[4px] bg-white-black text-white-black-inverted hover:opacity-90"
          onClick={(e) => {
            e.stopPropagation();
            sendOnClick && sendOnClick();
          }}
          type="button"
        >
          <SendArrow size={22} />
        </button>
      ) : mode === "create-task-modal" ? (
        <div className="flex flex-col gap-2 items-end w-full">
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("Save");
            }}
          >
            Save
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("SaveAndClose");
            }}
          >
            {" "}
            Save and close
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              sendOnClick && sendOnClick("SaveAndNew");
            }}
          >
            Save and create new task
          </span>
        </div>
      ) : (
        <div className="flex justify-between w-full gap-2 items-center">
          {mode === "read-edit-description" && (
            <Trash2
              size={20}
              className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
              id={mode + "-discard-draft-button"}
              strokeWidth={1.75}
              onClick={handleDiscardDrafts}
            />
          )}
          {audioTiptapCallback && mode === "read-edit-description" && (
            <AudioButton
              callbackHandler={audioTiptapCallback}
              editor={editor}
              id={mode + "-audio-button"}
              toggleRecording={toggleRecording!}
              visualizerClassName="mb-0"
            />
          )}
          <span
            onClick={(e) => {
              e.stopPropagation;
              sendOnClick && sendOnClick();
            }}
          >
            Save
          </span>
        </div>
      )}
    </span>
  );
};


export const DesktopAttachment = ({
  mode,
  sendOnClick,
  handleAttachmentClick,
  presentInInbox,
  handleCallback,
  status,
  handleDiscardDrafts,
  showDeleteComment,
  onCancelEditComment,
  toggleAiTaskWriter,
  audioTiptapCallback,
  audioDefaultContent,
  toggleRecording,
  editor,
  isRecording,
  hideComposerDictation,
  dictationCoordinator,
}: {
  sendOnClick?: TSendBackAttachmentButton;
  mode: RedirectMode;
  handleAttachmentClick: (e?: any) => void;
  presentInInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
  discardDrafts?: (discard: "Description" | "Comment") => void;
  showDeleteComment: boolean | undefined;
  onCancelEditComment?: () => void;
  handleDiscardDrafts: () => void;
  toggleAiTaskWriter?: () => void;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  editor: Editor | null;
  isRecording?: boolean;
  hideComposerDictation?: boolean;
  dictationCoordinator?: DictationCoordinator;
}) => {
  const isApple = useDeviceContext();
  const ctrlCmd = isApple ? "CMD" : "CTRL";
  const altOptions = isApple ? "OPT" : "ALT";

  return (
    <div
      className={`attachment-button p-0 flex flex-row   rounded-sm justify-between items-center w-full `}
    >
      {!isRecording && (
        <BottomButtons
          ctrlCmd={ctrlCmd}
          altOptions={altOptions}
          mode={mode}
          sendOnClick={sendOnClick}
          handleCallback={handleCallback}
          presentInInbox={presentInInbox}
          status={status}
        />
      )}
      {/* While recording, the waveform bar takes over the whole toolbar row:
          the send/attach/ai/improve/trash siblings collapse and the recorder
          flexes to full width (mirrors the mobile branch). */}
      <div
        className={`flex gap-2 items-center ${
          isRecording ? "flex-1 w-full" : ""
        }`}
      >
        {!isRecording && mode !== "read-edit-comments" && (
          <span className="relative group">
            <span
              className="text-hypertasks-ai-purple ml-auto text-emphasis cursor-pointer"
              id={mode + "-ai-writer-button"}
              onClick={() => {
                toggleAiTaskWriter && toggleAiTaskWriter();
              }}
            >
              ai
            </span>
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, "J"]}
              text={"Ai Task Writer"}
            />
          </span>
        )}

        {!isRecording && mode !== "read-edit-comments" && (
          <span className="relative group">
            <Paperclip
              size={16}
              className="text-icon-dark-gray hover:text-white-black ml-auto  cursor-pointer  "
              onClick={handleAttachmentClick}
              strokeWidth={1.75}
            />
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, `Shift`, "A"]}
              text={"Attach Files"}
            />
          </span>
        )}
        {audioTiptapCallback && !hideComposerDictation && (
          <AudioButton
            callbackHandler={audioTiptapCallback}
            editor={editor}
            id={mode + "-audio-button"}
            toggleRecording={toggleRecording!}
            dictationCoordinator={dictationCoordinator}
          />
        )}
        {!isRecording &&
          mode !== "read-edit-comments" &&
          mode !== "create-task-modal" &&
          ((mode === "create-comment" && showDeleteComment === true) ||
            mode === "read-edit-description") && (
            <span className="relative group">
              <Trash2
                size={16}
                className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
                id={mode + "-discard-draft-button"}
                strokeWidth={1.75}
                onClick={handleDiscardDrafts}
              />
              <Tooltip
                left={0}
                bottom={-45}
                keyCombination={[`${ctrlCmd}`, `Shift`, ","]}
                text={"Discard draft"}
              />
            </span>
          )}
        {!isRecording && mode === "read-edit-comments" && onCancelEditComment && (
          <span className="relative group">
            <Trash2
              size={16}
              className="text-icon-dark-gray hover:text-white-black ml-auto cursor-pointer"
              id={mode + "-cancel-edit-button"}
              strokeWidth={1.75}
              onClick={onCancelEditComment}
            />
            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={["ESC"]}
              text={"Cancel edit"}
            />
          </span>
        )}
      </div>
    </div>
  );
};


export interface IDescriptionOption {
  title: string;
  value: TSendBackButtonParam;
  keyComb: string[];
  tooltip?: string;
}


export interface IBottomButtonProps {
  ctrlCmd: "CMD" | "CTRL";
  altOptions: "ALT" | "OPT";
  mode: RedirectMode;
  sendOnClick?: TSendBackAttachmentButton;
  presentInInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
}


export const BottomButtons = ({
  mode,
  ctrlCmd,
  sendOnClick,
  presentInInbox,
  handleCallback,
  altOptions,
  status,
}: IBottomButtonProps) => {
  const spanClassName =
    "text-content text-icon-dark-gray hover:text-white-black  cursor-pointer font-semibold relative group whitespace-nowrap";
  // Settings > Profile > Inbox. Was gated on ?inboxFlow=true before.
  const advanceOnSend = useGetUserPreferences().data.inboxAdvanceOnSend ?? true;

  const DescriptionOptions: IDescriptionOption[] = [
    {
      title: "Save",
      value: "Save",
      keyComb: [`${ctrlCmd}`, "Enter"],
    },
    {
      title: "Save & close",
      value: "SaveAndClose",
      keyComb: [`${ctrlCmd}`, `${altOptions}`, "Enter"],
      tooltip: "Save and close",
    },
    {
      title: "Save & new",
      value: "SaveAndNew",
      keyComb: [`${ctrlCmd}`, `${altOptions}`, "SHIFT", "Enter"],
      tooltip: "Save and create new task",
    },
  ];

  const SecondButtonToolTip = {
    text: presentInInbox
      ? status === "Archive"
        ? "Send + Archive + Unmark Task As Done + Next Task"
        : "Send + Archive + Mark Task As Done + Next Task"
      : "Send + Next Task",
    keyComb: presentInInbox
      ? [`${ctrlCmd}`, `${altOptions}`, "SHIFT", "Enter"]
      : [`${ctrlCmd}`, "SHIFT", "Enter"],
  };

  const toolTipText =
    mode === "create-comment"
      ? presentInInbox
        ? advanceOnSend
          ? "Send + Archive + Next Task"
          : "Send + Archive"
        : "Send"
      : mode === "read-edit-comments"
      ? "Update comment"
      : mode === "create-task-modal"
      ? "Create task"
      : "Save description";

  const getKeyCombinationForSend = () => {
    // On an inbox task, plain send is the archive button, so the bare "Send"
    // beside it is the shift variant.
    if (presentInInbox) return [`${ctrlCmd}`, "SHIFT", "Enter"];
    return [`${ctrlCmd}`, "Enter"];
  };

  if (mode === "create-task-modal" || mode === "read-edit-description") {
    return (
      <div className="flex gap-4 items-center">
        {mode === "create-task-modal" &&
          DescriptionOptions.map(
            (option: IDescriptionOption, index: number) => (
              <span
                key={`description-tiptap-buttons-${index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sendOnClick && sendOnClick(option.value);
                }}
                className={spanClassName}
              >
                {option.title}

                <Tooltip
                  left={0}
                  bottom={-45}
                  keyCombination={option.keyComb}
                  text={option.tooltip ?? option.title}
                />
              </span>
            )
          )}
        {mode === "read-edit-description" && (
          <>
            <span
              onClick={(e) => {
                e.stopPropagation();
                sendOnClick && sendOnClick("Save");
              }}
              className={spanClassName}
            >
              Save
              <Tooltip
                left={0}
                bottom={-45}
                keyCombination={[`${ctrlCmd}`, "Enter"]}
                text={"Save Changes"}
              />
            </span>
            <span
              className={
                "text-content text-[#C2CFA5] cursor-default font-semibold"
              }
            >
              Unsaved Changes
            </span>
          </>
        )}
      </div>
    );
  } else
    return (
      // Comment Send Buttons
      <div className="flex gap-6">
        {presentInInbox && mode !== "read-edit-comments" ? (
          <span
            onClick={() =>
              presentInInbox
                ? handleCallback &&
                  handleCallback(
                    advanceOnSend ? "moveToNext" : undefined,
                    presentInInbox
                  )
                : sendOnClick && sendOnClick()
            }
            className={spanClassName}
          >
            {["create-comment"].includes(mode) ? <CustomArchiveIcon /> : "Save"}

            <Tooltip
              left={0}
              bottom={-45}
              keyCombination={[`${ctrlCmd}`, "Enter"]}
              text={toolTipText}
            />
          </span>
        ) : (
          <></>
        )}
        <span
          onClick={() => sendOnClick && sendOnClick()}
          className={spanClassName}
        >
          Send
          {mode === "create-comment" && (
            <>
              <Tooltip
                left={0}
                bottom={-40}
                keyCombination={getKeyCombinationForSend()}
                text={"Send"}
              />
              <Tooltip
                left={0}
                bottom={-75}
                keyCombination={SecondButtonToolTip.keyComb}
                text={SecondButtonToolTip.text}
              />
            </>
          )}
        </span>
      </div>
    );
};


export const CustomArchiveIcon = ({ markAndMove }: { markAndMove?: boolean }) => {
  return (
    <span className=" inline-flex items-center">
      Send +&nbsp;
      <svg
        className={`text-[#696b6e] group-hover:fill-white-black`}
        width={14}
        fill={"#696b6e"} // Change fill color based on hover state
        height={14}
        viewBox={`0 0 18 18`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M16 12H12C12 13.7 10.7 15 9 15C7.3 15 6 13.7 6 12H2V2H16M16 0H2C0.9 0 0 0.9 0 2V16C0 17.1 0.9 18 2 18H16C17.1 18 18 17.1 18 16V2C18 0.9 17.1 0 16 0ZM11.1 3.5L12.5 4.9L10.4 7L12.5 9.1L11.1 10.5L9 8.4L6.9 10.5L5.5 9.1L7.6 7L5.5 4.9L6.9 3.5L9 5.6L11.1 3.5Z" />
      </svg>
      {markAndMove && (
        <>
          &nbsp;+&nbsp;
          <Check
            color={"#696b6e"}
            className={`text-[#696b6e] group-hover:text-white-black`}
            size={14}
            strokeWidth={1.75}
          />
        </>
      )}
    </span>
  );
};
