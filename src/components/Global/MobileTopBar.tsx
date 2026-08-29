/* eslint-disable @next/next/no-img-element */
"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { useRecoilValue } from "@/lib/state";
import { mobileTopBarTitleAtom } from "@/store";
import { IUser } from "@/models/model";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

const MobileTitleSheet = lazy(() => import("./MobileTitleSheet"));
const MobileHeaderStrip = lazy(() => import("./MobileHeaderStrip"));
const MobileTopBarActions = lazy(() => import("./MobileTopBarActions"));

const MobileTopBar = ({
  currentUser,
  boardUsable,
}: {
  currentUser: IUser;
  boardUsable: boolean;
}) => {
  const pathname = usePathname();
  const calendarTitle = useRecoilValue(mobileTopBarTitleAtom);
  const [showBoards, setShowBoards] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const onCalendar = pathname?.startsWith("/calendar") ?? false;
  const onDetail = pathname?.startsWith("/detail") ?? false;
  const onProject = pathname?.startsWith("/project") ?? false;
  const deferredControlsReady = !onProject || boardUsable;
  const fallbackTitle = onCalendar
    ? calendarTitle ?? "Calendar"
    : pathname?.startsWith("/inbox")
      ? "Inbox"
      : pathname?.startsWith("/search")
        ? "Search"
        : "Board";

  // On the task-detail page the top bar collapses on scroll so the sticky task
  // headline takes the top edge. We translate it up by the scroll offset
  // (capped at its own height), so it slides out exactly as the headline slides
  // up to fill the gap — no layout jump — and slides back in at scroll top.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    if (!onDetail) {
      header.style.transform = "";
      return;
    }
    let frame: number | undefined;
    const apply = () => {
      frame = undefined;
      const scrolled =
        window.scrollY || document.documentElement.scrollTop || 0;
      const shift = Math.max(0, Math.min(scrolled, header.offsetHeight));
      header.style.transform = shift > 0 ? `translateY(-${shift}px)` : "";
    };
    const onScroll = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      header.style.transform = "";
    };
  }, [onDetail, pathname]);

  return (
    <>
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-[300] flex items-stretch gap-[10px] bg-containerBackground px-[14px] will-change-transform md:hidden"
        // Height is the 48px bar PLUS the status-bar inset, and the inset is the
        // padding — so the icon row keeps its full 48px inside the gray band and
        // the band extends up behind the status bar. A fixed h-12 let the inset
        // eat into the 48px (icons squished onto black) and left the content
        // offset (--mobile-top-bar-h) taller than the bar, opening a black gap.
        style={{
          height: "calc(48px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {/* Sidebar = boards, mirroring desktop's Ctrl+B panel toggle. */}
        <button
          type="button"
          aria-label="Switch board"
          onClick={() => setShowBoards(true)}
          className={`${MOBILE_TARGET} text-white-black`}
        >
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>

        {/* Clip the scrolling strip so it never collides with the pinned edges. */}
        <div className="relative flex min-w-0 flex-1 items-stretch overflow-hidden">
          {deferredControlsReady ? (
            <Suspense
              fallback={(
                <span className="flex min-w-0 items-center truncate text-dense font-semibold text-white-black">
                  {fallbackTitle}
                </span>
              )}
            >
              <MobileHeaderStrip calendarTitle={calendarTitle} />
            </Suspense>
          ) : (
            <span className="flex min-w-0 items-center truncate text-dense font-semibold text-white-black">
              {fallbackTitle}
            </span>
          )}
        </div>

        {deferredControlsReady && (
          <Suspense fallback={null}>
            <MobileTopBarActions
              currentUser={currentUser}
              onCalendar={onCalendar}
            />
          </Suspense>
        )}
      </header>

      {showBoards && (
        <Suspense fallback={null}>
          <MobileTitleSheet onClose={() => setShowBoards(false)} />
        </Suspense>
      )}
    </>
  );
};

export default MobileTopBar;
