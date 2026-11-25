import type { ReactNode } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9622_AMOLED_FLOATING_BUTTON_RING_FLAG } from "@/lib/flags/definitions/htpr-9622-amoled-floating-button-ring";

type MobileFloatingActionButtonProps = {
  ariaLabel: string;
  bottomOffset?: number;
  icon: ReactNode;
  onClick: () => void;
  size?: "primary" | "secondary";
  stackOffset?: number;
};

const MobileFloatingActionButton = ({
  ariaLabel,
  bottomOffset,
  icon,
  onClick,
  size = "primary",
  stackOffset = 0,
}: MobileFloatingActionButtonProps) => {
  const amoledRing = useFlag(HTPR_9622_AMOLED_FLOATING_BUTTON_RING_FLAG);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`fixed right-4 z-menu inline-flex ${size === "secondary" ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-full border border-border-light-gray-thin bg-modalBackground p-0 text-content font-semibold text-white-black shadow-customshadow-2 transition-colors hover:bg-hover-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline md:hidden${amoledRing ? " [.amoled_&]:[--bs-border-color:var(--border-light-gray-thin)]" : ""}`}
      style={{
        bottom:
          bottomOffset === undefined
            ? "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))"
            : `calc(${bottomOffset}px + 16px)`,
        transform: stackOffset > 0 ? `translateY(-${stackOffset}px)` : undefined,
      }}
    >
      {icon}
    </button>
  );
};

export default MobileFloatingActionButton;
