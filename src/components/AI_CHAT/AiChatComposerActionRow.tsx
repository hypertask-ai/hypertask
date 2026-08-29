import React, { type ReactNode } from "react";

type AiChatComposerActionRowProps = {
  mobileRecording: boolean;
  leadingControls: ReactNode;
  beforeRecorder: ReactNode;
  recorder: ReactNode;
  afterRecorder: ReactNode;
};

export function AiChatComposerActionRow({
  mobileRecording,
  leadingControls,
  beforeRecorder,
  recorder,
  afterRecorder,
}: AiChatComposerActionRowProps) {
  return (
    <div
      data-ai-chat-action-row
      className={`flex w-full items-center justify-between pt-2 ${
        mobileRecording ? "min-w-0 gap-0" : "gap-2"
      }`}
    >
      <div
        data-ai-chat-leading-controls
        hidden={mobileRecording}
        className={`flex min-w-0 items-center gap-2 text-meta text-gray-400 ${
          mobileRecording ? "hidden" : ""
        }`}
      >
        {leadingControls}
      </div>
      <div
        data-ai-chat-recorder-row
        className={`flex items-center justify-center ${
          mobileRecording ? "min-w-0 flex-1 gap-0" : "flex-none gap-2"
        }`}
      >
        <div
          data-ai-chat-before-recorder
          hidden={mobileRecording}
          className={mobileRecording ? "hidden" : "contents"}
        >
          {beforeRecorder}
        </div>
        {recorder}
        <div
          data-ai-chat-after-recorder
          hidden={mobileRecording}
          className={mobileRecording ? "hidden" : "contents"}
        >
          {afterRecorder}
        </div>
      </div>
    </div>
  );
}
