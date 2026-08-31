import type { ReactNode } from "react";

type MobileFloatingActionButtonProps = {
  ariaLabel: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

const MobileFloatingActionButton = ({
  ariaLabel,
  icon,
  label,
  onClick,
}: MobileFloatingActionButtonProps) => (
  <button
    type="button"
    aria-label={ariaLabel}
    onClick={onClick}
    className="fixed right-4 z-[200] inline-flex min-h-11 items-center gap-2 rounded-full border border-border-light-gray-thin bg-modalBackground px-4 text-content font-semibold text-white-black shadow-customshadow-2 transition-colors hover:bg-hover-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline md:hidden"
    style={{
      bottom:
        "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))",
    }}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export default MobileFloatingActionButton;
