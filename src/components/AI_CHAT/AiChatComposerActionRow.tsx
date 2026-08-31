import { Plus } from "lucide-react";
import React, { type ReactNode } from "react";

const mobileActionClass =
  "flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:text-white-black";

type AiChatComposerActionRowProps = {
  mobile: boolean;
  mobileDictating: boolean;
  hasText: boolean;
  leadingControls: ReactNode;
  attachmentControl: ReactNode;
  contextControl: ReactNode;
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
  recorder,
  streamControl,
  sendControl,
}: AiChatComposerActionRowProps) {
  return (
    <div
      data-ai-chat-action-row
      className={`flex w-full items-center justify-between pt-2 ${
        mobileDictating ? "min-w-0 gap-0" : "gap-2"
      }`}
    >
      <div
        data-ai-chat-leading-controls
        hidden={mobileDictating}
        className={`flex min-w-0 items-center gap-2 text-meta text-gray-400 ${
          mobileDictating ? "hidden" : ""
        }`}
      >
        {leadingControls}
      </div>
      <div
        data-ai-chat-recorder-row
        className={`flex items-center justify-center ${
          mobileDictating ? "min-w-0 flex-1 gap-0" : "flex-none gap-2"
        }`}
      >
        {mobile ? (
          <>
            <details
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
                className="absolute bottom-[calc(100%_+_0.5rem)] right-0 z-[1100] flex items-center gap-3 rounded-[4px] bg-modalBackground p-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center"
              >
                {attachmentControl}
                {contextControl}
              </div>
            </details>
            {recorder}
            <div
              data-ai-chat-stream-control
              hidden={mobileDictating}
              className={`order-3 ${mobileDictating ? "hidden" : ""}`}
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
