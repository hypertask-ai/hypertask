import { IOption, TAiMode } from "@/models/AI_Task_writer_model";
import { useEffect, useMemo, useState } from "react";
import { AppSheet, SheetScroller } from "@/components/Modals/Sheets";

const acceptDescOnlyOption = {
  display: "Accept description only",
  action: "AcceptDescOnly",
  loadingText: "",
};
const acceptDescTitleOption = {
  display: "Accept description and task title",
  action: "AcceptDescTitle",
  loadingText: "",
};
const acceptAllOption = {
  display: "Accept ALL (description, title, status, priority, size, tags)",
  action: "AcceptAll",
  loadingText: "",
};
const normalOptions = [
  {
    display: "Retry",
    action: "Rephrase the following description: \n",
    loadingText: "Retrying...",
  },
  {
    display: "Improve writing",
    action: "Improve the writing aspect of the following description: ",
    loadingText: "Improving the text and writing...",
  },
  {
    display: "Simplify",
    action: "Simplify the following description: ",
    loadingText: "Simplifying for simplicity...",
  },
  {
    display: "Shorten",
    action: "Shorten the following description: ",
    loadingText: "Shortening...",
  },
  {
    display: "Extend",
    action: "Extend the following description: ",
    loadingText: "Extending the previous response...",
  },
];

const taskWriterOptions = [
  acceptAllOption,
  acceptDescTitleOption,
  acceptDescOnlyOption,
  ...normalOptions,
];
const writeWithAiOptions = [{
  display: "Accept",
  action: "Accept",
  loadingText: "",
},...normalOptions];

/** Short label for the always-visible primary button on mobile */
function primaryActionLabel(option: IOption): string {
  switch (option.action) {
    case "AcceptAll":
      return "Accept all";
    case "AcceptDescTitle":
      return "Accept title & description";
    case "AcceptDescOnly":
      return "Accept description only";
    default:
      return option.display;
  }
}

/** Nested sheet: force theme surface (library defaults to light). */
const nestedSheetContainerClass =
  "!bg-comment-description text-white-black rounded-t-2xl border-thin border-hypertasks-ai-purple/60 shadow-lg";

type Presentation = "inlineMenu" | "mobileActionSheet";

const AI_Options = ({
  callback,
  inputValue = "",
  mode,
  presentation = "inlineMenu",
  onResend,
  isResendDisabled = false,
}: {
  callback: (optionPrompt: string, loadingText?: string) => void;
  inputValue: string;
  mode: TAiMode;
  /** Mobile: tap opens a dedicated action sheet with large rows (HTPR-3061). */
  presentation?: Presentation;
  /** Mobile: send the user's currently editable prompt as a new request. */
  onResend?: () => void;
  /** Resend is unavailable until its prompt and request prerequisites are ready. */
  isResendDisabled?: boolean;
}) => {
  const allOptions = useMemo(
    () => (mode === "WriteWithAI" ? writeWithAiOptions : taskWriterOptions),
    [mode]
  );

  const filteredOptions = useMemo(
    () =>
      allOptions.filter((x) =>
        x.display.toLowerCase().includes(inputValue.toLowerCase())
      ),
    [allOptions, inputValue]
  );

  const [currIdx, setCurrIdx] = useState(0);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    setCurrIdx(0);
  }, [filteredOptions.length, inputValue, mode]);

  const upHandler = () => {
    if (currIdx === 0) return;
    const selectedIdx =
      (currIdx + filteredOptions.length - 1) % filteredOptions.length;
    setCurrIdx(selectedIdx);
    document.getElementById(`command-${selectedIdx}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  const downHandler = () => {
    if (currIdx === filteredOptions.length - 1) return;
    const selectedIdx = (currIdx + 1) % filteredOptions.length;
    setCurrIdx(selectedIdx);
    document.getElementById(`command-${selectedIdx}`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  const enterHandler = () => {
    if (filteredOptions.length > 0)
      return callback(
        filteredOptions[currIdx].action,
        filteredOptions[currIdx].loadingText
      );
    return callback(inputValue, "Retrying again with: \n" + inputValue);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (presentation === "mobileActionSheet") return;
    if (event.shiftKey) return;
    if (event.key === "ArrowUp") {
      return upHandler();
    }
    if (event.key === "ArrowDown") {
      return downHandler();
    }
    if (event.key === "Enter") {
      enterHandler();
    }
  };

  useEffect(() => {
    if (presentation === "mobileActionSheet") return;
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [currIdx, filteredOptions, presentation, inputValue]);

  const runOption = (option: IOption) => {
    callback(option.action, option.loadingText);
    setActionSheetOpen(false);
  };

  if (presentation === "mobileActionSheet") {
    // Always use full option list for mobile so the primary action stays predictable (fast path).
    const primaryOption = allOptions[0];
    const secondaryOptions = allOptions.slice(1);

    return (
      <>
        <div
          className={
            secondaryOptions.length > 0
              ? "flex flex-wrap gap-2 items-stretch"
              : "flex flex-col"
          }
        >
          <button
            type="button"
            onClick={() => callback(primaryOption.action, primaryOption.loadingText)}
            className={`min-h-[44px] min-w-0 rounded-lg border-thin border-hypertasks-ai-purple/70 bg-hypertasks-ai-purple/25 py-2.5 px-3 text-center text-content font-semibold text-white-black active:opacity-90 ${
              secondaryOptions.length > 0 ? "flex-1 truncate" : "w-full py-3"
            }`}
          >
            {primaryActionLabel(primaryOption)}
          </button>
          {onResend && (
            <button
              type="button"
              onClick={onResend}
              disabled={isResendDisabled}
              aria-label="Resend with current prompt"
              title={isResendDisabled ? "Write a prompt before resending" : "Resend with current prompt"}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border-thin border-hypertasks-ai-purple/70 bg-hypertasks-ai-purple/25 py-2.5 px-3 text-center text-content font-semibold text-white-black active:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Resend
            </button>
          )}
          {secondaryOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setActionSheetOpen(true)}
              title="Other apply and refine options"
              className="min-h-[44px] w-full rounded-lg border-thin border-border-light-gray-thin bg-comment-description px-3 py-2.5 text-center text-content font-medium text-text-light-gray"
            >
              More
            </button>
          )}
        </div>
        <AppSheet
          isOpen={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          detent="content-height"
          sheetClassName="!z-[13000]"
          disableScrollLocking
          ariaLabel="Other apply and refine actions"
          panelClassName={nestedSheetContainerClass}
          bodyClassName="!bg-comment-description pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <p className="px-3 pt-1 pb-2 text-dense font-medium text-text-light-gray">
            Other apply &amp; refine actions
          </p>
          <SheetScroller draggableAt="top" className="max-h-[min(70dvh,520px)]">
            {secondaryOptions.map((option, index) => (
              <button
                key={`${option.action}-${index}`}
                type="button"
                onClick={() => runOption(option)}
                className="flex w-full border-0 border-b border-border-light-gray-thin px-3 py-2 text-left leading-snug text-white-black last:border-b-0 active:bg-active-modal-element"
              >
                {option.display}
              </button>
            ))}
          </SheetScroller>
          <button
            type="button"
            onClick={() => setActionSheetOpen(false)}
            className="mt-2 w-full px-4 py-3.5 text-center text-content font-medium text-text-light-gray"
          >
            Cancel
          </button>
        </AppSheet>
      </>
    );
  }

  return (
    <div className="bg-modalBackground text-content shadow-customshadow-1  rounded border-thin border-border-light-gray-thin">
      {filteredOptions.map((option, index) => (
        <div
          id={`command-${index}`}
          onClick={() => callback(option.action, option.loadingText)}
          onMouseEnter={() => setCurrIdx(index)}
          className={`${
            index === currIdx && " bg-active-modal-element"
          } cursor-pointer px-2 py-1 `}
          key={`${option.action}-${index}`}
        >
          {option.display}
        </div>
      ))}
    </div>
  );
};

export default AI_Options;
