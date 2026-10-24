import React, { useContext, useLayoutEffect, useRef, useState } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG } from "@/lib/flags/keys";
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
  const chatOverlaysTicket = useFlag(HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG);
  const settingsChatEnabled = useFlag(HTPR_7622_AI_SETTINGS_FLAG);
  const overlayDetailPage = chatOverlaysTicket && isDetailPage;
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
    if (isMobile || sidebarWidthPx <= 0) return;
    const update = () => setSidebarOverlays(
      window.innerWidth < Math.max(768, sidebarWidthPx + (overlayDetailPage ? DETAIL_PAGE_MIN_WIDTH : 340))
    );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isMobile, sidebarWidthPx, overlayDetailPage]);

  const workspaceClasses = cn(
    "outline-none",
    mobileTopBarVisible &&
      "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]",
    mobileTabBarVisible && "pb-[var(--mobile-dock-h,64px)]",
    mobilePullCommandEnabled && "mobile-pull-command-enabled"
  );

  if (
    (pathname?.startsWith("/settings") && !settingsChatEnabled) ||
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
          ? sidebarOverlays
            ? "fixed right-0 top-0 z-[51]"
            : "shrink-0 max-md:fixed max-md:right-0 max-md:top-0 max-md:z-[51]"
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
