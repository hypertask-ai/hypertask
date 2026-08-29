"use client";
import { useContext, useEffect, useState } from "react";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Funnel,
  ArrowUpDown,
  RotateCcw,
  Save,
} from "lucide-react";
import { DragDropContext } from "@hello-pangea/dnd";
import { Card, CardContent, CardHeader } from "./card";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import styles from "@/styles/search.module.scss";
import Tooltip from "@/components/Common/Tooltip";
import KBDElement from "@/components/Common/kbd";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import {
  appShellRailAtom,
  calendarBoardsSidebarOpenAtom,
  calendarSettingsAtom,
} from "@/store";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import BoardPriorityMode from "@/components/Modals/Kanban/BoardPriorityMode";
import CalendarViewsModal from "@/components/Modals/Calendar/views.modal";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import CalendarSplitsRow from "./CalendarSplitsRow";
import GuestAuthLinks from "@/components/PageComponents/Kanban/HeaderComponents/GuestAuthLinks";
import { getCalendarTitle } from "./calendarTitle";

export function Calendar() {
  const {
    currentView,
    onDragEnd,
    handlePrevious,
    handleNext,
    setCurrentView,
    handleDateSelect,
    currentDate,
    toggleFilterModal,
    taskFilters,
    calendarSort,
    setCalendarSort,
    isCalendarViewDirty,
    resetCalendarView,
  } = useCalendarContext();
  const setBoardsSidebarOpen = useSetRecoilState(calendarBoardsSidebarOpenAtom);
  const calendarSettings = useRecoilValue(calendarSettingsAtom);
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [showSortModal, setShowSortModal] = useState(false);
  const [calendarViewsModal, setCalendarViewsModal] = useState<"save" | null>(
    null,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "v" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !returnIfModalOrInputActive()
      ) {
        event.preventDefault();
        setCalendarViewsModal("save");
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const title = getCalendarTitle({
    currentView,
    currentDate,
    today: new Date(),
    weekStartsOn: calendarSettings.weekStartsOn === "monday" ? 1 : 0,
  });
  const hasActiveTaskFilters =
    taskFilters.assignedToMe ||
    taskFilters.priority.length > 0 ||
    taskFilters.assignees.length > 0 ||
    taskFilters.assigneeAgents.length > 0 ||
    taskFilters.updatedBy.length > 0 ||
    taskFilters.createdBy.length > 0 ||
    taskFilters.updatedByAgents.length > 0 ||
    taskFilters.labels.length > 0 ||
    taskFilters.size.length > 0;

  return (
    <div
      suppressHydrationWarning
      autoFocus={false}
      className={
        appShellRailOn
          ? `${currentView !== "month" ? "h-screen overflow-hidden" : "min-h-screen"} bg-pageBackground my-0 w-full flex flex-col linksModal pt-2 ${styles.links_modal}`
          : `${currentView !== "month" ? "h-screen overflow-hidden" : "min-h-screen"} bg-containerBackground my-0 w-full flex flex-col linksModal pt-2 ${styles.links_modal}`
      }
    >
      <div
        className={
          appShellRailOn
            ? "flex-1 h-full flex flex-col min-h-0"
            : "flex-1 h-full flex flex-col"
        }
      >
        <Card
          className={
            appShellRailOn
              ? `bg-transparent min-h-0 border-none border-0 shadow-none w-full gap-0 flex-1 flex flex-col ${currentView !== "month" ? "h-full overflow-hidden" : "min-h-full"} py-0`
              : `bg-card border-none border-0 shadow-none w-full gap-0 flex-1 flex flex-col ${currentView !== "month" ? "h-full overflow-hidden" : "min-h-full"} py-0`
          }
        >
          <CardHeader
            className={
              appShellRailOn
                ? "py-2 gap-0"
                : "border-b border-border py-2 gap-0"
            }
          >
            <div className="flex items-center gap-2 text-[13.5px] font-normal @md:gap-3">
              <div className="relative group">
                <button
                  type="button"
                  aria-label="Toggle boards and filters panel"
                  onClick={() => setBoardsSidebarOpen(true)}
                  className="flex h-8 w-8 items-center justify-center text-text-light-gray"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  >
                    <rect x="1.3" y="2.3" width="13.4" height="11.4" rx="1.6" />
                    <path d="M6.1 2.3v11.4" />
                  </svg>
                </button>
                <Tooltip
                  left={-10}
                  bottom={-40}
                  text="Toggle boards and filters panel"
                  keyCombination={[]}
                />
              </div>

              <div className="relative z-30 flex min-w-0 shrink items-center gap-2 rounded-[7px] bg-containerBackground px-2 py-[5px] text-text-light-gray @lg:gap-[11px] @lg:px-[11px]">
                <DropDownButton
                  selectedView={currentView}
                  optionCallback={(item) => setCurrentView(item)}
                />

                {/* The panel holds the month date-picker, so the date range is
                    the obvious way in: same target as the panel icon. */}
                <div className="relative group min-w-0 shrink">
                  <button
                    type="button"
                    onClick={() => setBoardsSidebarOpen(true)}
                    className="block w-full min-w-0 truncate whitespace-nowrap text-left text-[13.5px] font-normal leading-normal text-white-black"
                  >
                    {title}
                  </button>
                  <Tooltip
                    bottom={-45}
                    left={0}
                    text="Boards and filters"
                    keyCombination={[]}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-2 @lg:gap-[11px]">
                  <div className="relative group">
                    <button
                      onClick={handlePrevious}
                      className="flex h-5 w-5 items-center justify-center bg-transparent text-text-light-gray"
                    >
                      <ChevronLeft size={16} strokeWidth={1.75} fill="none" />
                    </button>
                    <Tooltip
                      bottom={-45}
                      left={0}
                      text={`Previous ${currentView}`}
                      keyCombination={["U"]}
                    />
                  </div>
                  <div className="relative group">
                    <button
                      onClick={handleNext}
                      className="flex h-5 w-5 items-center justify-center bg-transparent text-text-light-gray"
                    >
                      <ChevronRight size={16} strokeWidth={1.75} fill="none" />
                    </button>
                    <Tooltip
                      bottom={-45}
                      left={0}
                      text={`Next ${currentView}`}
                      keyCombination={["I"]}
                    />
                  </div>
                </div>

                <div className="relative hidden shrink-0 group @lg:block">
                  <div
                    className="cursor-pointer whitespace-nowrap font-normal leading-normal text-text-light-gray"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDateSelect(new Date());
                    }}
                  >
                    <span>Today</span>
                  </div>
                  <Tooltip
                    bottom={-45}
                    left={0}
                    text="Today"
                    keyCombination={["T"]}
                  />
                </div>
              </div>

              <CalendarSplitsRow />

              {isCalendarViewDirty && (
                <>
                  <div className="flex items-center gap-3 font-normal text-text-light-gray lg:hidden">
                    <span
                      onClick={() => setCalendarViewsModal("save")}
                      className="group relative"
                    >
                      <Save
                        size={18}
                        strokeWidth={1.75}
                        className="cursor-pointer text-[#E28C28]"
                      />
                      <Tooltip
                        left={-10}
                        bottom={-40}
                        text="Save view"
                        keyCombination={[]}
                      />
                    </span>
                    <span
                      onClick={resetCalendarView}
                      className="group relative"
                    >
                      <RotateCcw
                        size={18}
                        strokeWidth={1.75}
                        className="cursor-pointer"
                      />
                      <Tooltip
                        left={-10}
                        bottom={-40}
                        text="Reset view"
                        keyCombination={[]}
                      />
                    </span>
                  </div>
                  <div className="hidden items-center gap-3 font-normal text-text-light-gray lg:flex">
                    <span
                      onClick={() => setCalendarViewsModal("save")}
                      className="group relative cursor-pointer text-[#E28C28]"
                    >
                      Save View
                      <Tooltip
                        left={-10}
                        bottom={-40}
                        text="Save View"
                        keyCombination={["SHIFT", "V"]}
                      />
                    </span>
                    <span
                      onClick={resetCalendarView}
                      className="cursor-pointer"
                    >
                      Reset
                    </span>
                  </div>
                </>
              )}

              <div className="relative group">
                <button
                  onClick={toggleFilterModal}
                  aria-label="Show filter options"
                  className={`flex h-8 w-8 items-center justify-center bg-transparent p-0 ${
                    hasActiveTaskFilters
                      ? "text-[#51A4F1]"
                      : "text-text-light-gray"
                  }`}
                >
                  <Funnel size={18} strokeWidth={1.75} fill="none" />
                </button>
                <Tooltip
                  bottom={-45}
                  left={0}
                  text="Show filter options"
                  keyCombination={["SHIFT", "F"]}
                />
              </div>

              <div className="relative group">
                <button
                  type="button"
                  onClick={() => setShowSortModal(true)}
                  aria-label="Show sorting options"
                  className={`flex h-8 w-8 items-center justify-center bg-transparent ${
                    calendarSort ? "text-[#51A4F1]" : "text-text-light-gray"
                  }`}
                >
                  <ArrowUpDown size={18} strokeWidth={1.75} />
                </button>
                <Tooltip
                  bottom={-45}
                  left={0}
                  text="Show sorting options"
                  keyCombination={[]}
                />
              </div>

              {/* Guest CTAs end this row; the floating copy skips /calendar so
                  they cannot land on top of the filter and sort controls. */}
              <GuestAuthLinks />
            </div>
          </CardHeader>
          <DragDropContext onDragEnd={onDragEnd}>
            <CardContent
              className={
                appShellRailOn
                  ? `p-0 flex-1 flex flex-col ${currentView !== "month" ? "h-full overflow-hidden" : "min-h-full"} mx-[12px] mb-[12px] min-h-0 w-[calc(100%-24px)] overflow-hidden rounded-md bg-containerBackground shadow-md`
                  : `p-0 flex-1 flex flex-col ${currentView !== "month" ? "h-full overflow-hidden" : "min-h-full"}`
              }
            >
              {currentView === "month" && <MonthView />}
              {/* Day view reuses WeekView: the weeks memo returns a single-day
                  row when currentView is "day". */}
              {currentView !== "month" && <WeekView />}
            </CardContent>
          </DragDropContext>
        </Card>
      </div>
      {showSortModal && (
        <BoardPriorityMode
          closeHandler={() => setShowSortModal(false)}
          sort={calendarSort}
          onSortChange={setCalendarSort}
          maxLevels={1}
        />
      )}
      {calendarViewsModal && (
        <CalendarViewsModal
          mode={calendarViewsModal}
          toggle={() => setCalendarViewsModal(null)}
        />
      )}
    </div>
  );
}

const DropDownButton = ({
  optionCallback,
  selectedView,
}: {
  selectedView: "day" | "week" | "month";
  optionCallback: (item: "day" | "week" | "month") => void;
}) => {
  const [isActive, setIsActive] = useState<number>(0);
  const [isDropDown, setIsDropDown] = useState<boolean>(false);
  const [hover, setHover] = useState<boolean>(false);

  // Determine the opposite view and its keyboard shortcut
  const getOtherView = () => {
    if (selectedView === "month") return { view: "week", key: "W" };
    if (selectedView === "week") return { view: "month", key: "M" };
    // If day view, default to week
    return { view: "week", key: "W" };
  };

  const otherView = getOtherView();

  return (
    <div className="relative inline-block w-[65px] shrink-0 text-left group @lg:w-[76px]">
      <button
        className="inline-block w-full font-normal leading-normal text-text-light-gray transition duration-150 ease-in-out"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          setIsDropDown((prev) => !prev);
          setIsActive(0);
        }}
      >
        <div className="flex w-full items-center justify-between gap-2 text-[13.5px] font-normal capitalize">
          <span>{selectedView}</span>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            fill="none"
            className={`flex-none transition-transform ${
              isDropDown ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      {hover && !isDropDown && (
        <Tooltip
          bottom={-45}
          left={0}
          text={`Switch to ${otherView.view}`}
          keyCombination={[otherView.key]}
        />
      )}

      {isDropDown && (
        <div className="absolute mt-2 top-full left-0 w-[100px] scrollbar-thin overflow-y-auto bg-modalBackground rounded-md shadow-md z-40">
          <ul className="">
            {["day", "week", "month"].map((option, index) => (
              <li
                key={`ai-option-label-${index}`}
                className={`capitalize text-content flex justify-between items-center min-h-[35px] cursor-pointer transition-all duration-75 gap-1 px-2 py-1 leading-normal ${
                  isActive === index ? "bg-active-modal-element" : ""
                }`}
                onMouseOver={() => setIsActive(index)}
                onClick={() => {
                  setIsDropDown((prev) => !prev);
                  optionCallback(option as any);
                  setIsActive(0);
                }}
              >
                <span>{option}</span>
                <KBDElement
                  className={`py-auto px-[6.25px] text-meta leading-[14px] font-semibold h-[20px] flex items-center justify-center mx-[0px] pt-[0px]`}
                  content={option === "day" ? "⇧D" : option[0]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
