"use client";

import { usePathname } from "next/navigation";
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { activeBuiltinViewsAtom, currentProjectAtom } from "@/store";
import { IProject } from "@/models/model";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import useRenderedViews from "@/hooks/Homepage/Views/useRenderedViews";
import { cn } from "@/utils/undoActions/helperFuncs";
import { getActiveBoardViewId } from "@/lib/constants/builtinViews";

interface IStripItem {
  key: string;
  label: string;
  count?: number;
  active: boolean;
  onSelect: () => void;
}

/**
 * The horizontally-swipeable middle of the mobile header: a lead label (the
 * surface name) followed by its splits, matching the desktop header row. Board
 * splits are the board's saved views; inbox splits are the notification tabs;
 * calendar has no inline splits (its board filter is a checkbox sheet).
 */
const Strip = ({ lead, items }: { lead?: string; items: IStripItem[] }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const activeKey = items.find((item) => item.active)?.key;

  // The strip scrolls but never scrolled itself, so on a board with several
  // views the selected one could sit past the right edge after a load and the
  // header read as though nothing was selected (HTPR-5097). Rect maths rather
  // than offsetLeft: the scroller is not a positioned ancestor, so offsetLeft
  // would be measured against something further up the tree.
  //
  // useLayoutEffect, not useEffect: an effect runs after paint, so the strip
  // would render once at scrollLeft 0 — the exact broken frame — before
  // snapping. This corrects it before the browser paints.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const tab = activeRef.current;
    if (!scroller || !tab) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const delta =
      tabBox.left - scrollerBox.left - (scrollerBox.width - tabBox.width) / 2;
    if (delta) scroller.scrollBy({ left: delta, behavior: "auto" });
  }, [activeKey, items.length]);

  return (
    <div
      ref={scrollerRef}
      className="flex flex-1 items-center gap-[18px] overflow-x-auto whitespace-nowrap text-dense scrollbar-none"
    >
      {lead && (
        <span className="shrink-0 font-semibold text-white-black">{lead}</span>
      )}
      {items.map((item) => (
        <button
          key={item.key}
          ref={item.active ? activeRef : undefined}
          type="button"
          role="tab"
          aria-selected={item.active}
          onClick={item.onSelect}
          className={cn(
            // The tabs measured 26x38, under the 44px minimum on both axes
            // (HTPR-5114). The strip scrolls and centres its active tab, so the
            // extra width costs nothing that is not already scrollable.
            "shrink-0 self-stretch border-b-2 pt-[7px] font-medium",
            "min-h-[44px] min-w-[44px]",
            item.active
              ? "border-white-black text-white-black"
              : "border-transparent text-text-light-gray",
          )}
        >
          {item.label}
          {item.count ? (
            <span className="ml-[3px] text-meta font-normal text-text-light-gray">
              {item.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
};

const SaveViewModal = lazy(
  () => import("@/components/Modals/ViewModals/SaveViewModal"),
);

const BoardStrip = ({ project }: { project: IProject }) => {
  const { switchViewHandler, resetView } = useKanbanViews(project);
  const [showSaveModal, setShowSaveModal] = useState(false);
  // ShellViewControls (desktop) never mounts on mobile and the legacy board
  // header is md-and-up only, so without this the Save view affordance did not
  // exist on phones: sort/filter changes could never be persisted (HTPR-5900).
  const isDirty = Boolean(
    project.project_view?.user_project_views[0]?.unsavedView,
  );
  const { renderedViews, viewTaskCounts } = useRenderedViews(project);
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
  const defaultViewId = project.project_view?.default_view_id;
  const activeViewId = getActiveBoardViewId(project, activeBuiltinViews);

  return (
    <>
    {isDirty && (
      <span className="flex shrink-0 items-center gap-2 pr-1">
        <button
          type="button"
          onClick={() => setShowSaveModal(true)}
          className="h-8 shrink-0 rounded-full bg-hover-active px-2 text-dense font-medium text-[#E28C28]"
        >
          Save view
        </button>
        <button
          type="button"
          onClick={() => resetView("ResetCurrent")}
          className="h-8 shrink-0 rounded-full bg-hover-active px-2 text-dense font-medium text-text-light-gray"
        >
          Reset
        </button>
      </span>
    )}
    <Strip
      items={renderedViews.map((view) => ({
        key: String(view.id),
        label:
          view.id === defaultViewId
            ? project.title || project.name
            : view.title,
        count: viewTaskCounts.get(view.id) ?? 0,
        active: view.id === activeViewId,
        onSelect: () => {
          if (view.id !== activeViewId) switchViewHandler(view);
        },
      }))}
    />
    {showSaveModal && (
      <Suspense fallback={null}>
        <SaveViewModal toggle={() => setShowSaveModal(false)} project={project} />
      </Suspense>
    )}
    </>
  );
};

const MobileHeaderStrip = ({
  calendarTitle,
}: {
  calendarTitle?: string | null;
}) => {
  const pathname = usePathname();
  const project = useRecoilValue(currentProjectAtom);

  if (pathname?.startsWith("/inbox")) return <Strip lead="Inbox" items={[]} />;
  if (pathname?.startsWith("/calendar"))
    return <Strip lead={calendarTitle ?? "Calendar"} items={[]} />;
  if (pathname?.startsWith("/search"))
    return <Strip lead="Search" items={[]} />;
  if (project) return <BoardStrip project={project} />;
  return <div className="flex-1" />;
};

export default MobileHeaderStrip;
