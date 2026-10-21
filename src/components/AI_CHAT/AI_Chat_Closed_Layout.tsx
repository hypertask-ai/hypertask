import React, { useContext, useLayoutEffect, useRef, useState } from "react";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import { HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG, HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG, HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG } from "@/lib/flags/keys";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";

const DETAIL_PAGE_MIN_WIDTH = 944;

interface AIChatClosedLayoutProps {
  children: React.ReactNode;
  mobileTopBarVisible?: boolean;
  mobileTabBarVisible?: boolean;
  mobilePullCommandEnabled?: boolean;
  onOpenAIChat: () => void;
  panels?: React.ReactNode;
  chatOpen?: boolean;
  sidebarWidthPx?: number;
}

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
  const narrowSidebarWidth = useFlag(HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG);
  const chatOverlaysTicket = useFlag(HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG);
  const overlayDetailPage = chatOverlaysTicket && isDetailPage;
  const phoneFlagOn = useFlag(HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG);
  const phoneFlagKnown = useFlagLoaded(HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG);
  const phoneWorkspaceWidth = phoneFlagOn || !phoneFlagKnown;
  const [sidebarOverlays, setSidebarOverlays] = useState(false);
  const previousIsMobile = useRef(isMobile);
  const [viewportKey, setViewportKey] = useState(0);

  useLayoutEffect(() => {
    if (previousIsMobile.current !== isMobile && isDetailPage && !chatOpen) {
      setViewportKey((key) => key + 1);
    }
    previousIsMobile.current = isMobile;
  }, [isMobile, isDetailPage, chatOpen]);

  useLayoutEffect(() => {
    if (!narrowSidebarWidth || isMobile || sidebarWidthPx <= 0) return;
    const update = () => setSidebarOverlays(
      window.innerWidth < Math.max(768, sidebarWidthPx + (overlayDetailPage ? DETAIL_PAGE_MIN_WIDTH : 340))
    );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [narrowSidebarWidth, isMobile, sidebarWidthPx, overlayDetailPage]);

  const workspaceClasses = cn(
    "outline-none",
    mobileTopBarVisible &&
      "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]",
    mobileTabBarVisible && "pb-[var(--mobile-dock-h,64px)]",
    mobilePullCommandEnabled && "mobile-pull-command-enabled"
  );

  if (
    pathname?.startsWith("/settings") ||
    pathname?.startsWith("/agents/chat")
  ) {
    return <>{children}</>;
  }

  const phoneDetailWithoutChat = isDetailPage && isMobile && !chatOpen;

  return (
    <div key={viewportKey} className={cn(phoneDetailWithoutChat ? "contents" : "flex", !isDetailPage && "h-screen")}>
      <div
        data-ai-workspace
        tabIndex={-1}
        className={cn(
          workspaceClasses,
          !phoneDetailWithoutChat && "@container min-w-0 flex-1",
          !isDetailPage && "overflow-x-auto"
        )}
      >
        {children}
      </div>
      {!phoneDetailWithoutChat && <div
        data-ai-chat-slot
        className={sidebarWidthPx > 0 && !isMobile
          ? narrowSidebarWidth
            ? sidebarOverlays
              ? "fixed right-0 top-0 z-[51]"
              : "shrink-0 max-md:fixed max-md:right-0 max-md:top-0 max-md:z-[51]"
            : phoneWorkspaceWidth
              ? "shrink-0 max-md:fixed max-md:right-0 max-md:top-0 max-md:z-[51]"
              : "shrink-0"
          : "contents"}
        style={sidebarWidthPx > 0 && !isMobile ? { width: sidebarWidthPx } : undefined}
      >
        {panels}
      </div>}
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
