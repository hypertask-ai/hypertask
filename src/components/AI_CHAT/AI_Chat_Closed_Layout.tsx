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
  /** Chat UI rendered beside the page once the chat runtime is mounted. */
  panels?: React.ReactNode;
  chatOpen?: boolean;
  sidebarWidthPx?: number;
}

/**
 * The workspace frame around every page, before and after AI chat loads. It
 * deliberately has no ChatProvider dependency, so the full chat hook graph
 * stays out of board hydration. The chat arrives later as `panels`, beside the
 * page: swapping this frame for another one remounted the whole route and made
 * an open board drop its columns (HTPR-6751).
 */
export default function AIChatClosedLayout({
  children,
  mobileTopBarVisible = false,
  mobileTabBarVisible = false,
  mobilePullCommandEnabled = false,
  onOpenAIChat,
  panels,
  chatOpen = false,
  sidebarWidthPx = 0,
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

  // Match AI_Chat_Layout: /agents/chat owns its own top-bar and dock insets
  // (AgentChatClient). Padding here doubles the chrome and pushes the composer
  // under the tab bar (HTPR-6407 phone FAIL).
  if (
    pathname?.startsWith("/settings") ||
    pathname?.startsWith("/agents/chat")
  ) {
    return <>{children}</>;
  }

  if (isDetailPage && isMobile && !chatOpen) {
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
      {/* Keep the page width stable while the open sidebar's chunks load. */}
      <div
        data-ai-chat-slot
        className={sidebarWidthPx > 0 && !isMobile ? "shrink-0" : "contents"}
        style={sidebarWidthPx > 0 && !isMobile ? { width: sidebarWidthPx } : undefined}
      >
        {panels}
      </div>
      {/* /agents/chat has its own details-pane chevron; keep this one off there. */}
      {panels === undefined && !isMobile && !pathname?.startsWith("/agents/chat") && (
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
