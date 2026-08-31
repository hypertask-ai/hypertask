import type { ReactNode } from "react";

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
}: MobileFloatingActionButtonProps) => (
  <button
    type="button"
    aria-label={ariaLabel}
    onClick={onClick}
    className={`fixed right-4 z-[200] inline-flex ${size === "secondary" ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-full border border-border-light-gray-thin bg-modalBackground p-0 text-content font-semibold text-white-black shadow-customshadow-2 transition-colors hover:bg-hover-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline md:hidden`}
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

export default MobileFloatingActionButton;
