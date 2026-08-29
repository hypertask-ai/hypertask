"use client";

import BackButton from "@/components/Buttons/BackButton";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import TableView from "@/components/PageComponents/Kanban/TableView/TableView";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { ISection, IUser } from "@/models/model";
import type { TBoardSortingViewMode } from "@/models/Views/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import styles from "@/styles/search.module.scss";
import { useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

interface IProps {
  sections: ISection[];
  tabs: string[];
  currentUser: IUser;
}

const MY_TASKS_SORTING_MODE = "DueDate" as TBoardSortingViewMode;

const MyTasks = ({ sections, tabs, currentUser }: IProps) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const showCommands = useRecoilValue(showCommandsAtom);
  const [activeSplit, setActiveSplit] = useState(0);
  const router = useRouter();

  const totalCount = useMemo(
    () => sections.reduce((total, section) => total + section.items.length, 0),
    [sections]
  );
  const visibleSections = useMemo(
    () =>
      activeSplit === 0
        ? sections
        : sections[activeSplit - 1]
          ? [sections[activeSplit - 1]]
          : [],
    [activeSplit, sections]
  );

  const updateSplit = useCallback(
    (index: number) => {
      setActiveSplit(Math.max(0, Math.min(index, tabs.length - 1)));
    },
    [tabs.length]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !showCommands.show && !returnIfModalOrInputActive()) {
        event.preventDefault();
        router.back();
        return;
      }
      if (
        event.key !== "Tab" ||
        tabs.length === 0 ||
        returnIfModalOrInputActive()
      )
        return;

      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      updateSplit((activeSplit + direction + tabs.length) % tabs.length);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeSplit, router, showCommands.show, tabs.length, updateSplit]);

  const tabLength = (index: number) =>
    index === 0 ? totalCount : sections[index - 1]?.items.length ?? 0;

  const splitTitles = tabs.map((item, index) => (
    <SplitTitle
      key={`split-my-tasks-${index}`}
      isSelected={activeSplit === index}
      onClick={() => updateSplit(index)}
      tab={{
        idx: index,
        project: item,
        length: tabLength(index),
        hasUnseen: false,
      }}
    />
  ));

  const content = (
    <div
      suppressHydrationWarning
      className={`py-9 h-screen min-h-0 overflow-hidden bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex linksModal ${styles.links_modal}`}
    >
      <div className="flex gap-5 px-[16px] @md:!px-[88px]">
        <span className="flex items-baseline gap-2 font-bold text-subheading text-white-black">
          <p>My Tasks</p>
          <span className="text-content font-normal text-text-light-gray">
            {totalCount}
          </span>
        </span>
      </div>

      <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-[78px] @lg:px-[73px] mt-4">
        <div className="flex flex-wrap grow">{splitTitles}</div>
      </div>

      <div className="mt-3 flex-1 min-h-0 w-full">
        <TableView
          filteredSections={visibleSections}
          _sections={visibleSections}
          _currentProject={null}
          _activeSortingMode={MY_TASKS_SORTING_MODE}
          currentUser={currentUser}
        />
      </div>

      <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none @md:gap-8 w-100 bg-hoverCardBackground h-20 @md:h-8 inbox_title">
        {splitTitles}
      </div>
    </div>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
      ) : (
        content
      )}
      <BackButton left={appShellRailOn ? 56 : undefined} />
    </>
  );
};

export default MyTasks;
