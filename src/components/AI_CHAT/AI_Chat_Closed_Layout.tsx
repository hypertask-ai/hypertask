import React, { useContext } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";

interface AIChatClosedLayoutProps {
  children: React.ReactNode;
  mobileTopBarVisible?: boolean;
  mobileTabBarVisible?: boolean;
  mobilePullCommandEnabled?: boolean;
  onOpenAIChat: () => void;
}

/**
 * The workspace frame while AI chat has not been requested. It deliberately
 * has no ChatProvider dependency, so the full chat hook graph stays out of
 * board hydration while preserving the same layout and desktop entry point.
 */
export default function AIChatClosedLayout({
  children,
  mobileTopBarVisible = false,
  mobileTabBarVisible = false,
  mobilePullCommandEnabled = false,
  onOpenAIChat,
}: AIChatClosedLayoutProps) {
  const pathname = usePathname();
  const isMobile = useContext(MobileViewContext);
  const isDetailPage = pathname?.startsWith("/detail") ?? false;

  const workspaceClasses = cn(
    "outline-none",
    mobileTopBarVisible &&
      "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]",
    mobileTabBarVisible && "pb-[var(--mobile-dock-h,64px)]",
    mobilePullCommandEnabled && "mobile-pull-command-enabled"
  );

  if (pathname?.startsWith("/settings")) return <>{children}</>;

  if (isDetailPage && isMobile) {
    return (
      <div data-ai-workspace tabIndex={-1} className={workspaceClasses}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("flex", !isDetailPage && "h-screen")}>
      <div
        data-ai-workspace
        tabIndex={-1}
        className={cn(
          workspaceClasses,
          "@container min-w-0 flex-1",
          !isDetailPage && "overflow-x-auto"
        )}
      >
        {children}
      </div>
      {!isMobile && (
        <button
          tabIndex={-1}
          onClick={onOpenAIChat}
          aria-label="Open AI chat"
          className="group fixed right-1 top-2 z-[60] flex h-[20px] items-center justify-center text-text-light-gray hover:text-white-black"
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
          <Tooltip left={-120} bottom={-8} text="AI chat" keyCombination={["5"]} />
        </button>
      )}
    </div>
  );
}
