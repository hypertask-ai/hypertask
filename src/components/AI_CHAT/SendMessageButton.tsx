import { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup";
import { useFlag } from "@/hooks/useFlag";
import Tooltip from "../Common/Tooltip";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { Send } from "lucide-react";
import { SendArrow } from "../Common/SendArrow";
import { type ComponentProps } from "react";

export function SendMessageButton({
  disabled,
  isByokBlocked = false,
  queueMode = false,
  mobile,
  label,
  onClick,
}: {
  disabled: boolean;
  isByokBlocked?: boolean;
  queueMode?: boolean;
  mobile: boolean;
  label?: string;
  onClick: () => void;
}) {
  const cleanup = useFlag(HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG);
  const sendTooltip =
    aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.send_button;
  let tooltipProps: ComponentProps<typeof Tooltip> = {
    ...sendTooltip,
    keyCombination: [...(sendTooltip.keyCombination ?? [])],
  };
  if (isByokBlocked) {
    tooltipProps = {
      text: "Enable API keys first",
      keyCombination: [] as string[],
      left: -175,
      bottom: 25,
    };
  } else if (queueMode) {
    tooltipProps = {
      text: "Queue message",
      keyCombination: ["enter"] as string[],
      left: -120,
      bottom: 25,
    };
  }

  let buttonClassName =
    "relative group disabled:text-gray-400 disabled:cursor-not-allowed rounded-sm";
  if (mobile) {
    buttonClassName =
      "relative group flex h-11 w-11 touch-manipulation items-center justify-center rounded-sm bg-shadcn-primary text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50";
  } else if (cleanup && label) {
    buttonClassName =
      "relative group flex h-7 items-center justify-center rounded bg-shadcn-primary px-2 text-dense text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50";
  } else if (!disabled && queueMode) {
    buttonClassName += " text-text-light-gray hover:text-white-black";
  } else if (!disabled) {
    buttonClassName += " text-button-arrow hover:opacity-80";
  }

  return (
    <button
      type="button"
      className={buttonClassName}
      onClick={onClick}
      disabled={disabled}
      aria-label={queueMode ? "Queue message" : cleanup && label ? label : "Send message"}
    >
      <Tooltip {...tooltipProps} />
      {mobile ? (
        <SendArrow size={22} />
      ) : cleanup && label ? (
        <span>{label}</span>
      ) : (
        <Send size={16} strokeWidth={1.75} />
      )}
    </button>
  );
}
