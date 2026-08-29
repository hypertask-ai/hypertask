"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import CalendarViewsModal from "@/components/Modals/Calendar/views.modal";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

// Mirrors the inbox split tab, minus its InboxZeroContext dependency: that
// context only wraps the inbox, and reading it here throws on /calendar.
const CalendarSplitTitle = ({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) => (
  <div
    className="relative group flex h-8 cursor-pointer items-center justify-start whitespace-nowrap text-[13.5px] font-normal"
    onClick={onClick}
  >
    <div className="flex items-baseline gap-1">
      <span className={isActive ? "text-white-black" : "text-text-light-gray"}>
        {label}
      </span>
      {count > 0 && (
        <span className="font-normal text-text-light-gray">
          {count}
        </span>
      )}
    </div>
  </div>
);

const CalendarSplitsRow = ({ mobile = false }: { mobile?: boolean }) => {
  const {
    calendarViews,
    appliedCalendarViewId,
    everythingTitle,
    applyCalendarView,
    calendarViewCounts,
    visibleTaskCount,
  } = useCalendarContext();
  const [manageViews, setManageViews] = useState(false);

  return (
    <>
      <div
        className={cn(
          "calendar-splits-row flex items-baseline overflow-hidden",
          mobile
            ? "h-10 w-full min-w-0 shrink-0 px-4 pt-2"
            : "min-w-[96px] flex-1",
        )}
      >
        <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none no-scrollbar">
          <div className="group relative flex min-w-max items-center gap-[9px]">
            <div id="calendar-view-split-all">
              <CalendarSplitTitle
                label={everythingTitle}
                count={visibleTaskCount}
                isActive={appliedCalendarViewId === null}
                onClick={() => void applyCalendarView(null)}
              />
            </div>
            {calendarViews.map((view) => (
              <div id={`calendar-view-split-${view.id}`} key={view.id}>
                <CalendarSplitTitle
                  label={view.title}
                  count={calendarViewCounts.get(view.id) ?? 0}
                  isActive={appliedCalendarViewId === view.id}
                  onClick={() => void applyCalendarView(view.id)}
                />
              </div>
            ))}
            <button
              type="button"
              aria-label="Manage calendar views"
              onClick={() => setManageViews(true)}
              className={
                mobile
                  ? `${MOBILE_TARGET} text-text-light-gray`
                  : "flex h-8 shrink-0 items-center justify-center px-1 text-text-light-gray"
              }
            >
              <Settings2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
      {manageViews && (
        <CalendarViewsModal
          mode="manage"
          toggle={() => setManageViews(false)}
        />
      )}
    </>
  );
};

export default CalendarSplitsRow;
