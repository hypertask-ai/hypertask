"use client";
import { ITask, IUser } from "@/models/model";
import { useContext, useEffect, useRef, useState } from "react";
import styles from "@/styles/search.module.scss";
import { useRouter } from "next/navigation";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  showCommandsAtom,
  tasksPlayListAtom,
  inViewObjectAtom,
  currentProjectAtom,
  activeItemAtom,
  appShellRailAtom,
} from "@/store";
import dynamic from "next/dynamic";
import BackButton from "@/components/Buttons/BackButton";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import globalConstants from "@/lib/constants";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { SplitTitle, TaskListRow } from "@/components/Common/TaskRowComponents/TaskListRow";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import {
  ALL_TASKS_DATE_RANGES,
  type AllTasksDateRange,
} from "@/lib/configs/allTasks.config";
const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

interface IProps {
  _allData: Record<string, any[]>;
  tabs: string[];
  currentUser: IUser;
  dateRange: AllTasksDateRange;
}

const AllTasks = ({ _allData, tabs, currentUser, dateRange }: IProps) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [allData, setAllData] = useState<Record<string, any[]>>(_allData);
  const [currentProject, ____] = useRecoilState(currentProjectAtom);
  const [__, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [_, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [___, setActiveItem] = useRecoilState(activeItemAtom);
  const [activeSplit, setActiveSplit] = useState<number>(0);
  const [tasks, setTasks] = useState<ITask[]>(allData["All"] ?? []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCommands, _____] = useRecoilState(showCommandsAtom);

  const { goToProjectShortcut } = useProjectQuery();
  const router = useRouter();
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const isApple = useDeviceContext();

  const [displayedRange, setDisplayedRange] =
    useState<AllTasksDateRange>(dateRange);
  const rangeSaveLock = useRef<Promise<void>>(Promise.resolve());
  const latestPickedRange = useRef<AllTasksDateRange>(dateRange);

  const handleDateRangeChange = (value: AllTasksDateRange) => {
    // Optimistic: reflect the pick immediately; the prop catches up when the
    // server render with the filtered data lands.
    setDisplayedRange(value);
    latestPickedRange.current = value;
    // The range is an account preference: persist it so every device opens
    // the same view. Saves are serialized so rapid picks can never commit out
    // of order (a superseded pick is skipped), and only the winning write
    // triggers the server refresh — refreshing earlier could read back the
    // previous preference and snap the selector to the old value.
    rangeSaveLock.current = rangeSaveLock.current.then(async () => {
      if (latestPickedRange.current !== value) return;
      try {
        const res = await fetch("/api/users/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allTasksDateRange: value }),
        });
        if (res.ok && latestPickedRange.current === value) router.refresh();
      } catch {
        // Keep the optimistic selection; it will re-save on the next change.
      }
    });
  };

  // --------------- Refs
  const ulRef = useRef<HTMLUListElement | null>(null);
  const liSelectedRef = useRef<HTMLLIElement | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentHoveredDiv = useRef<number | null>(null);
  const lastgClick = useRef<number | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  // =========================== LINK CLICK HANDLER
  const handleLinkClick = async (task: ITask, idx: number) => {
    setSelectedIndex(idx);
    const tasksPlayList = tasks.map((task) => ({
      projectId: task.projectId,
      uniqueIndex: task.uniqueIndex,
    }));
    setTasksPlayList(tasksPlayList);
    router.push(
      `/detail/project-${task.projectId}/${task.uniqueIndex}?inboxFlow=true`
    );
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  };

  const handleKeyDown = async (event: KeyboardEvent) => {
    var cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = true;
    }

    // Don't hijack Escape while the user is in a form control (e.g. the
    // date-range select): the browser should dismiss it, not router.back().
    const activeTag = document.activeElement?.tagName;
    const inFormControl =
      activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
    if (event.keyCode === KeyCodes.ESCAPE && !showCommands.show && !inFormControl) {
      event.preventDefault();
      return router.back();
    }
    if (activeTag === "SELECT") {
      // Arrows/Enter/space belong to the native dropdown; anything else is a
      // task shortcut, so hand focus back to the page first — a select that
      // closes without a change event (re-confirming the current value) must
      // not leave every shortcut dead.
      const nativeSelectKeys: number[] = [
        KeyCodes.ARROW_UP,
        KeyCodes.ARROW_DOWN,
        KeyCodes.ENTER,
        KeyCodes.SPACE,
      ];
      if (nativeSelectKeys.includes(event.keyCode)) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (
      (inFormControl && activeTag !== "SELECT") ||
      returnIfModalOrInputActive()
    )
      return;

    // press k
    if (event.keyCode === KeyCodes.K && (cmdControl || event.ctrlKey)) {
      event.preventDefault();
      toggleShowCommands();
    }

    if (tasks.length > 0) {
      const index = selectedIndex;
      // =========== [Down Movement]
      if (
        event.keyCode === KeyCodes.J ||
        event.keyCode === KeyCodes.ARROW_DOWN
      ) {
        // down
        if (tasks[selectedIndex]) {
          if (index === -1 || index === tasks.length - 1) {
          } else {
            updateActiveItemAndItemInView(tasks[index + 1]);
            scrollToTask(index + 1);
            setSelectedIndex(index + 1);
          }
        } else {
          if (tasks.length > 0) {
            updateActiveItemAndItemInView(tasks[0]);
            scrollToTask(0);
            setSelectedIndex(0);
          }
        }

        // ------------------------------ UP MOVEMENT ------------------------------
      } else if (
        event.keyCode === KeyCodes.K ||
        event.keyCode === KeyCodes.ARROW_UP
      ) {
        // up
        if (tasks[selectedIndex]) {
          if (index <= 0) {
          } else {
            updateActiveItemAndItemInView(tasks[index - 1]);
            scrollToTask(index - 1);
            setSelectedIndex(index - 1);
          }
        } else {
          if (tasks.length > 0) {
            updateActiveItemAndItemInView(tasks[tasks.length - 1]);
            scrollToTask(tasks.length - 1);
            setSelectedIndex(tasks.length - 1);
          }
        }
      }

      // [Visit Task] Enter
      else if (event.keyCode === KeyCodes.ENTER) {
        event.preventDefault();
        handleLinkClick(tasks[index], index);
      }

      // [Archive/Unarchive] cmd/ctrl + e
      else if (event.keyCode === KeyCodes.E && cmdControl) {
        event.preventDefault();
        if (!shouldRunArchiveShortcut(event)) return;
        markAsDone();
      }

      // [JUMP TO REPLY] cmd/ctrl + m
      else if (event.keyCode === KeyCodes.M && cmdControl) {
        event.preventDefault();
        router.push(
          `/detail/project-${tasks[index].projectId}/${tasks[index].uniqueIndex}?reply=true`
        );
      }

      // [alt][v]
      else if (
        event.keyCode === KeyCodes.V &&
        event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        router.push(
          `/detail/project-${tasks[index].projectId}/${tasks[index].uniqueIndex}?audio=true`
        );
      }
    }
    // ========== [g] then [g] Jump to top/bottom row
    if (controller[KeyCodes.G]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        if (event.shiftKey) {
          updateActiveItemAndItemInView(tasks[tasks.length - 1]);
          scrollToTask(tasks.length - 1);
          setSelectedIndex(tasks.length - 1);
        } else {
          updateActiveItemAndItemInView(tasks[0]);
          scrollToTask(0);
          setSelectedIndex(0);
        }
      }
    }

    // ========== [g]
    if (event.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay); // 1000 milliseconds = 1 second
    }

    // ========== [g] then  [t]
    if (controller[KeyCodes.T]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        if (tasks[selectedIndex].projectId === currentProject?.id)
          router.push("/");
          else goToProjectShortcut(tasks[selectedIndex].projectId);
      }
    }

    if (controller[KeyCodes.D]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        router.push(globalConstants.draftsRoute);
      }
    }

    if (controller[KeyCodes.U]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        router.push("/scheduled");
      }
    }

    if (event.keyCode === KeyCodes.TAB && tabs.length > 0) {
      event.preventDefault();
      let newValue;
      if (event.shiftKey) {
        // Navigate to the previous tab
        newValue = activeSplit !== 0 ? activeSplit - 1 : tabs.length - 1;
      } else {
        // Navigate to the next tab
        newValue = activeSplit !== tabs.length - 1 ? activeSplit + 1 : 0;
      }

      updateSplitAndTasks(newValue);
    }
  };

  //  -------------------------- MOUSE LEAVE EVENT ----------------------------
  const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && liSelectedRef.current) {
        (liSelectedRef.current as HTMLLIElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  };
  const handleMouseEnter = (index: number) => {
    currentHoveredDiv.current = index;
  };

  //  -------------------------- MOUSE MOVE EVENT ----------------------------
  const handleMouseMove = () => {
    // Clear any existing debounceTimeout
    if (
      debounceTimeout.current &&
      document.activeElement?.id !== "linksModal"
    ) {
      setSelectedIndex(
        currentHoveredDiv.current ? currentHoveredDiv.current : 0
      );
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
  };

  // ----------------------- [PRESS E] || [CLICK ON MARK AS DONE] (mark as done)
  const markAsDone = async () => {
    if (!tasks[selectedIndex]) return;

    const response = await fetch(`/api/tasks/single`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newTask: {
          id: tasks[selectedIndex].id,
          status:
            tasks[selectedIndex].status === "Archive" ? "Normal" : "Archive",
        },
      }),
    });

    if (response.status === 200) {
      //lets update this task everywhere shall we
      let currentTasks: any[] = [];
      setAllData((prev) => {
        // Create a new object to avoid direct mutation
        const newData = { ...prev };

        // Update tasks in "All" tab
        newData["All"] = prev["All"].map((task) => {
          if (task.id === tasks[selectedIndex].id) {
            return {
              ...task,
              status: task.status === "Archive" ? "Normal" : "Archive",
            };
          }
          return task;
        });

        // Update tasks in current active tab
        if (tabs[activeSplit] !== "All") {
          newData[tabs[activeSplit]] = prev[tabs[activeSplit]].map((task) => {
            if (task.id === tasks[selectedIndex].id) {
              return {
                ...task,
                status: task.status === "Archive" ? "Normal" : "Archive",
              };
            }
            return task;
          });
        }
        if (tabs[activeSplit] === "All") currentTasks.push(...newData["All"]);
        else currentTasks.push(...newData[tabs[activeSplit]]);
        return newData;
      });

      setTasks(currentTasks);
    }
  };

  const updateActiveItemAndItemInView = (task: ITask) => {
    setActiveItem(task.id);
    setInViewObject({
      taskId: task.id,
      taskProjectId: task?.projectId ?? null,
      sectionId: task?.sectionId ?? null,
      taskTicketNumber: task?.ticketNumber ?? null,
      sectionTitle: task?.section ?? null,
      taskTitle: task?.title ?? null,
    });
  };

  const scrollToTask = (index: number) =>
    document?.getElementById(`inbox-${tasks[index]?.id}`)?.scrollIntoView({
      behavior: "smooth" as ScrollBehavior,
      block: "center",
    });

  const updateSplitAndTasks = (index: number) => {
    setActiveSplit(index);
    setTasks(allData[tabs[index]]);
    setSelectedIndex(0);
    scrollToTask(0);
  };

  useEffect(() => {
    setAllData(_allData);
    setTasks(_allData[tabs[0]] ?? []);
    setActiveSplit(0);
    setSelectedIndex(0);
    setDisplayedRange(dateRange);
  }, [_allData, dateRange, tabs]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    tasks,
    showCommands.show,
    selectedIndex,
    lastgClick,
    activeSplit,
    allData,
    controller,
  ]);

  const content = (
      <div
        suppressHydrationWarning
        onClick={(e) => setSelectedIndex(0)}
        autoFocus={false}
        className={`py-9 min-h-screen bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex  linksModal  ${styles.links_modal}`}
      >
        <div className="px-4 @md:px-0">
          <div className="flex items-center justify-between gap-5 @md:px-[40px]">
          <span className={`flex gap-1 font-bold text-subheading text-white-black`}>
            <p>All Tasks</p>
          </span>
          <label className="flex shrink-0 items-center gap-2 text-[12px] text-gray-400">
            <span className="hidden @sm:inline">Updated</span>
            <select
              aria-label="Task date range"
              value={displayedRange}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // Escape dismisses the native popup; also hand focus back so
                // the task-list shortcuts come alive again (no change event
                // fires on dismiss). stopPropagation keeps the page-level
                // Escape handler from turning this into router.back().
                event.stopPropagation();
                event.currentTarget.blur();
              }}
              onChange={(event) => {
                // Hand focus back to the page after picking: the shortcut
                // guard ignores keys while a form control has focus, so
                // leaving it here would silence the task list until a click.
                event.currentTarget.blur();
                handleDateRangeChange(event.target.value as AllTasksDateRange);
              }}
              className="h-8 appearance-none rounded-[4px] bg-active-modal-element px-2 text-[12px] text-white-black outline-none border-none transition-colors hover:bg-hoverCardBackground"
            >
              {ALL_TASKS_DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* SplitTitle adds 10px at md and 15px at lg. Keep its text at the
            same 40px gutter as the heading and task-row project text. */}
        <div className="mt-4 hidden w-full overflow-x-auto @md:block @md:px-[30px] @lg:px-[25px] scrollbar-none no-scrollbar">
          <div className="flex flex-wrap grow">
            {tabs.map((item, index) => (
              <SplitTitle
                key={`split-alltasks-${index}`}
                isSelected={activeSplit === index}
                onClick={() => updateSplitAndTasks(index)}
                tab={{
                  idx: index,
                  project: item,
                  length: allData[item].length,
                  hasUnseen: false,
                }}
              />
            ))}
          </div>
        </div>

        <div className="w-full">
          <div className="p-0 rounded-b-[4px]  ">
            <ul
              id="users-list"
              ref={ulRef}
              onMouseMove={handleMouseMove}
              className="rounded-b-[4px] mt-3 px-0 @md:!px-16 text-dense text-gray-200 overflow-y-auto scrollbar-none pb-20 @md:!pb-0"
              aria-labelledby="assignDelayButton"
            >
              {tasks &&
                tasks.map((task: ITask, index: number) => {
                  return (
                    <TaskListRow
                      task={task}
                      index={index}
                      handleLinkClick={handleLinkClick}
                      handleMouseEnter={handleMouseEnter}
                      handleMouseLeave={handleMouseLeave}
                      selected={selectedIndex===index}
                      flushMobilePadding
                      key={`list-row-all-tasks-${index}`}
                    />
                  );
                })}
            </ul>
          </div>
        </div>
        </div>
        <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none  @md:gap-8 w-100 bg-hoverCardBackground  h-20 @md:h-8 inbox_title">
          {tabs.map((item, index) => (
            <SplitTitle
              key={`split-alltasks-${index}`}
              isSelected={activeSplit === index}
              onClick={() => updateSplitAndTasks(index)}
              tab={{
                idx: index,
                project: item,
                length: allData[item].length,
                hasUnseen: false,
              }}
            />
          ))}
        </div>
      </div>
  );

  return (
    <>
      {appShellRailOn && <AppShellRail variant="global" currentUser={currentUser} />}
      {appShellRailOn ? <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div> : content}
      <BackButton left={appShellRailOn ? 56 : undefined} />
      {showCommands.show && <HypertasksCommands />}
    </>
  );
};

export default AllTasks;
