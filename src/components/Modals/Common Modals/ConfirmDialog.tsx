import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, type ReactNode } from "react";

type ConfirmDialogProps = {
  id: string;
  icon?: LucideIcon;
  message: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  loadingLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmShortcut?: "enter" | "ctrl-enter";
  footerVerb?: string;
  className?: string;
};

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-sm bg-label-span px-[5px] py-[2px] font-sans text-micro font-medium leading-none text-white-black">
    {children}
  </kbd>
);

const ConfirmDialog = ({
  id,
  icon: Icon,
  message,
  children,
  confirmLabel,
  loadingLabel,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  confirmShortcut = "enter",
  footerVerb = "confirm",
  className,
}: ConfirmDialogProps) => {
  const closeHandler = useCallback(() => {
    if (loading) return;
    onCancel();
  }, [loading, onCancel]);

  const confirmHandler = useCallback(() => {
    if (loading || confirmDisabled) return;
    onConfirm();
  }, [confirmDisabled, loading, onConfirm]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isEscape = event.key === "Escape";
      const isEnter = event.key === "Enter";
      const isConfirm =
        isEnter &&
        (confirmShortcut === "enter" || event.ctrlKey || event.metaKey);

      if (!isEscape && !isConfirm) return;

      // While this modal is up it owns ESC and its confirm shortcut: keep them
      // away from the handlers underneath it (the AI writer, the editors).
      event.preventDefault();
      event.stopImmediatePropagation();

      if (loading) return;
      if (isEscape) closeHandler();
      else confirmHandler();
    },
    [closeHandler, confirmHandler, confirmShortcut, loading],
  );

  useEffect(() => {
    // Capture phase, deliberately: the keypress that opened this modal is still
    // propagating up when we mount, and it has already passed document capture,
    // so it cannot reach this listener and dismiss the modal it just opened.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleKeyDown]);

  const shortcutLabel =
    confirmShortcut === "ctrl-enter" ? "CTRL+ENTER" : "ENTER";
  const footerShortcut = confirmShortcut === "ctrl-enter" ? "ctrl ↵" : "↵";

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id={id}
      toggle={closeHandler}
      // ESC is handled above; reactstrap's own handler would also see the
      // still-propagating keypress that opened this modal and close it.
      keyboard={false}
      className={`sm:min-w-[560px] sm:top-[24%] ${className ?? ""}`}
      contentClassName="rounded-[5px] overflow-hidden"
    >
      <div className="rounded-[5px] p-0">
        <div className="flex items-center gap-2.5 border-b border-light-black-border-1 px-4 py-3.5 text-dense">
          {Icon && (
            <Icon
              strokeWidth={1.75}
              size={13}
              className="shrink-0 text-text-light-gray"
            />
          )}
          <span>{message}</span>
        </div>
        {children}
        <ul className="m-0 list-none py-1.5">
          <li
            onClick={confirmHandler}
            aria-disabled={confirmDisabled || undefined}
            className={
              confirmDisabled
                ? "mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense transition-colors duration-75 cursor-not-allowed opacity-40"
                : "mx-1.5 flex h-[36px] cursor-pointer items-center justify-between rounded-sm bg-active-modal-element px-3 text-dense"
            }
          >
            <span>{loading ? (loadingLabel ?? confirmLabel) : confirmLabel}</span>
            <Kbd>{shortcutLabel}</Kbd>
          </li>
          <li
            onClick={closeHandler}
            className="mx-1.5 flex h-[36px] cursor-pointer items-center justify-between rounded-sm px-3 text-dense transition-colors duration-75 hover:bg-active-modal-element"
          >
            <span>Cancel</span>
            <Kbd>ESC</Kbd>
          </li>
        </ul>
        <div className="flex items-center gap-4 border-t border-light-black-border-1 px-4 py-2 text-micro text-text-light-gray">
          <span>
            <Kbd>{footerShortcut}</Kbd> {footerVerb}
          </span>
          <span>
            <Kbd>esc</Kbd> cancel
          </span>
        </div>
      </div>
    </ModalContainerCustom>
  );
};

export default ConfirmDialog;
