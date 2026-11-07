import { Paperclip } from "lucide-react";
import Tooltip from "../Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";

export function AttachmentButton({
  disabled,
  onClick,
  mobile = false,
}: {
  disabled: boolean;
  mobile?: boolean;
  onClick: (e?: any) => void;
}) {
  const isApple = useDeviceContext();
  return (
    <button
      type={mobile ? "button" : undefined}
      className={`relative group rounded-sm text-icon-dark-gray hover:text-white-black${mobile ? " flex h-11 w-11 items-center justify-center" : ""}`}
      onClick={(e) => onClick(e)}
      disabled={disabled}
      aria-label="Attach files"
    >
      <Tooltip
        {...aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.attachment_button(
          isApple
        )}
      />
      <Paperclip size={16} strokeWidth={1.75} />
    </button>
  );
}

