import { Plus } from "lucide-react";
import React, { type ReactNode, useEffect, useRef } from "react";

const mobileActionClass =
  "flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:text-white-black";

type AiChatComposerActionRowProps = {
  mobile: boolean;
  mobileDictating: boolean;
  hasText: boolean;
  leadingControls: ReactNode;
  attachmentControl: ReactNode;
  contextControl: ReactNode;
  screenshotControl: ReactNode;
  recorder: ReactNode;
  streamControl: ReactNode;
  sendControl: ReactNode;
};

export function AiChatComposerActionRow({
  mobile,
  mobileDictating,
  hasText,
  leadingControls,
  attachmentControl,
  contextControl,
  screenshotControl,
  recorder,
  streamControl,
  sendControl,
}: AiChatComposerActionRowProps) {
  const overflowRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!mobile) return;

    const onPointerDown = (event: PointerEvent) => {
      const overflow = overflowRef.current;
      if (overflow?.open && !overflow.contains(event.target as Node)) {
        overflow.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && overflowRef.current) {
        overflowRef.current.open = false;
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobile]);

  useEffect(() => {
    if (mobileDictating && overflowRef.current) {
      overflowRef.current.open = false;
    }
  }, [mobileDictating]);

  let recorderRowClassName = "flex-none gap-2";
  if (mobileDictating) recorderRowClassName = "min-w-0 flex-1 gap-0";
  else if (mobile) recorderRowClassName = "w-full gap-2";

  return (
    <div
      data-ai-chat-action-row
      className={`flex w-full items-center justify-between pt-2 ${
        mobileDictating ? "min-w-0 gap-0" : "gap-2"
      }`}
    >
      {!mobile && (
        <div
          data-ai-chat-leading-controls
          className="flex min-w-0 items-center gap-2 text-meta text-gray-400"
        >
          {leadingControls}
        </div>
      )}
      <div
        data-ai-chat-recorder-row
        className={`flex items-center justify-center ${recorderRowClassName}`}
      >
        {mobile ? (
          <>
            <details
              ref={overflowRef}
              data-ai-chat-mobile-overflow
              hidden={mobileDictating}
              className="order-1 relative shrink-0"
            >
              <summary
                aria-label="More chat actions"
                className={`${mobileActionClass} list-none cursor-pointer [&::-webkit-details-marker]:hidden`}
              >
                <Plus size={20} strokeWidth={1.75} aria-hidden />
              </summary>
              <div
                role="group"
                aria-label="More chat actions"
                onClick={() => {
                  if (overflowRef.current) overflowRef.current.open = false;
                }}
                className="absolute bottom-[calc(100%_+_0.5rem)] left-0 z-[1100] flex items-center gap-3 rounded-[4px] bg-modalBackground p-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center"
              >
                {attachmentControl}
                {contextControl}
                {screenshotControl}
              </div>
            </details>
            {recorder}
            <div
              data-ai-chat-stream-control
              hidden={mobileDictating}
              className={`order-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center ${
                mobileDictating ? "hidden" : ""
              }`}
            >
              {streamControl}
            </div>
            {hasText && !mobileDictating ? (
              <div data-ai-chat-primary-send className="order-4">
                {sendControl}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {attachmentControl}
            {recorder}
            {contextControl}
            {streamControl}
            {sendControl}
          </>
        )}
      </div>
    </div>
  );
}
