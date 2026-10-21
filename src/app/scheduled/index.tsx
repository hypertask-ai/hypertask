"use client";
import { ITask } from "@/models/model";
import { useEffect, useRef, useState } from "react";
import styles from "@/styles/search.module.scss";
import { useRouter } from "next/navigation";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import {
  showCommandsAtom,
  tasksPlayListAtom,
  inViewObjectAtom,
  currentProjectAtom,
  activeItemAtom,
} from "@/store";
import dynamic from "next/dynamic";
import BackButton from "@/components/Buttons/BackButton";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import globalConstants from "@/lib/constants";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import {
  getAllTasksFlat,
  GroupedTasks,
  groupTasksByDueDate,
} from "@/utils/helperFunctions/Views/scheduleViewHelper";
import { TaskListRow } from "@/components/Common/TaskRowComponents/TaskListRow";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import { AllCommands } from "@/components/Modals/commands/HTC/AllCommands";
import { CommandMode } from "@/models/enums";
import toast from "react-hot-toast";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

interface IProps {
  _allData: Record<string, any[]>;
  tabs: string[];
}

const AllDueDates = ({ _allData, tabs }: IProps) => {
  const [allData, setAllData] = useState<Record<string, any[]>>(_allData);
  const currentProject = useRecoilValue(currentProjectAtom);
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const setActiveItem = useSetRecoilState(activeItemAtom);
  const [activeSplit, setActiveSplit] = useState<number>(0);
  const [groupedTasks, setGroupedTasks] = useState<GroupedTasks>(
    groupTasksByDueDate(allData["All"] ?? [])
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);

  const allTasksFlat = getAllTasksFlat(groupedTasks);

  const { goToProjectShortcut } = useProjectQuery();
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const router = useRouter();
  const isApple = useDeviceContext();

  const ulRef = useRef<HTMLUListElement | null>(null);
  const liSelectedRef = useRef<HTMLLIElement | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentHoveredDiv = useRef<number | null>(null);
  const lastgClick = useRef<number | null>(null);
  const selectedTaskIdRef = useRef<number | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  const handleLinkClick = async (task: ITask, idx: number) => {
    setSelectedIndex(idx);
    const tasksPlayList = allTasksFlat.map((task) => ({
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

    if (event.keyCode === KeyCodes.ESCAPE && !showCommands.show) {
      event.preventDefault();
      return router.back();
    }
    if (returnIfModalOrInputActive()) return;

    if (event.keyCode === KeyCodes.K && cmdControl) {
      event.preventDefault();
      toggleShowCommands();
    }

    if (event.keyCode === KeyCodes.D) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastgClick.current = null;
        router.push(globalConstants.draftsRoute);
        return;
      }

      event.preventDefault();
      setShowCommands({
        show: true,
        mode: CommandMode.SetDueDate,
      });
    }

    if (event.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastgClick.current = null;
        router.push("/scheduled");
        return;
      }
    }

    if (allTasksFlat.length > 0) {
      const index = selectedIndex;
      if (
        event.keyCode === KeyCodes.J ||
        event.keyCode === KeyCodes.ARROW_DOWN
      ) {
        if (allTasksFlat[selectedIndex]) {
          if (index === -1 || index === allTasksFlat.length - 1) {
          } else {
            updateActiveItemAndItemInView(allTasksFlat[index + 1]);
            scrollToTask(index + 1);
            setSelectedIndex(index + 1);
          }
        } else {
          if (allTasksFlat.length > 0) {
            updateActiveItemAndItemInView(allTasksFlat[0]);
            scrollToTask(0);
            setSelectedIndex(0);
          }
        }
      } else if (
        event.keyCode === KeyCodes.K ||
        event.keyCode === KeyCodes.ARROW_UP
      ) {
        if (allTasksFlat[selectedIndex]) {
          if (index <= 0) {
          } else {
            updateActiveItemAndItemInView(allTasksFlat[index - 1]);
            scrollToTask(index - 1);
            setSelectedIndex(index - 1);
          }
        } else {
          if (allTasksFlat.length > 0) {
            updateActiveItemAndItemInView(
              allTasksFlat[allTasksFlat.length - 1]
            );
            scrollToTask(allTasksFlat.length - 1);
            setSelectedIndex(allTasksFlat.length - 1);
          }
        }
      }

      else if (event.keyCode === KeyCodes.ENTER) {
        event.preventDefault();
        router.push(
          `/detail/project-${allTasksFlat[index].projectId}/${allTasksFlat[index].uniqueIndex}`
        );
      }

      else if (event.keyCode === KeyCodes.E && cmdControl) {
        event.preventDefault();
        if (!shouldRunArchiveShortcut(event)) return;
        markAsDone();
      }

      else if (event.keyCode === KeyCodes.M && cmdControl) {
        event.preventDefault();
        router.push(
          `/detail/project-${allTasksFlat[index].projectId}/${allTasksFlat[index].uniqueIndex}?reply=true`
        );
      }

      else if (
        event.keyCode === KeyCodes.V &&
        event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        router.push(
          `/detail/project-${allTasksFlat[index].projectId}/${allTasksFlat[index].uniqueIndex}?audio=true`
        );
      }
    }
    if (controller[KeyCodes.G]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        if (event.shiftKey) {
          updateActiveItemAndItemInView(allTasksFlat[allTasksFlat.length - 1]);
          scrollToTask(allTasksFlat.length - 1);
          setSelectedIndex(allTasksFlat.length - 1);
        } else {
          updateActiveItemAndItemInView(allTasksFlat[0]);
          scrollToTask(0);
          setSelectedIndex(0);
        }
      }
    }

    if (event.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay);
    }

    if (controller[KeyCodes.T]?.pressed) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        if (allTasksFlat[selectedIndex]?.projectId === currentProject?.id)
          router.push("/");
        else goToProjectShortcut(allTasksFlat[selectedIndex]?.projectId);
      }
    }

    if (event.keyCode === KeyCodes.TAB && tabs.length > 0) {
      event.preventDefault();
      let newValue;
      if (event.shiftKey) {
        newValue = activeSplit !== 0 ? activeSplit - 1 : tabs.length - 1;
      } else {
        newValue = activeSplit !== tabs.length - 1 ? activeSplit + 1 : 0;
      }

      updateSplitAndTasks(newValue);
    }
  };

  const handleMouseLeave = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

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

  const handleMouseMove = () => {
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

  const markAsDone = async () => {
    if (!allTasksFlat[selectedIndex]) return;

    const selectedTaskId = allTasksFlat[selectedIndex].id;
    selectedTaskIdRef.current = selectedTaskId;

    const response = await fetch(`/api/tasks/single`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newTask: {
          id: selectedTaskId,
          status:
            allTasksFlat[selectedIndex].status === "Archive"
              ? "Normal"
              : "Archive",
        },
      }),
    });

    if (response.status === 200) {
      setAllData((prev) => {
        const newData = { ...prev };

        Object.keys(newData).forEach((tabKey) => {
          newData[tabKey] = prev[tabKey].map((task) => {
            if (task.id === selectedTaskId) {
              return {
                ...task,
                status: task.status === "Archive" ? "Normal" : "Archive",
              };
            }
            return task;
          });
        });

        return newData;
      });

      toast.success(
        `Task ${
          allTasksFlat[selectedIndex].status === "Archive"
            ? "unarchived"
            : "archived"
        } successfully`
      );
    }
  };

  const updateDueDate = (dueDate: Date | undefined) => {
    if (!allTasksFlat[selectedIndex]) return;
    
    const selectedTask = allTasksFlat[selectedIndex];
    const selectedTaskId = selectedTask.id;
    const currentDueDate = selectedTask.dueDate;
    const newDate = dueDate ? new Date(dueDate) : undefined;
    
    const areDatesEqual = (date1: Date | null | undefined, date2: Date | null | undefined): boolean => {
      if (!date1 && !date2) return true;
      if (!date1 || !date2) return false;
      return date1.getTime() === date2.getTime();
    };
    
    if (areDatesEqual(currentDueDate, newDate)) return;
    
    selectedTaskIdRef.current = selectedTaskId;

    if (dueDate === undefined) {
      setAllData((prev) => {
        const newData = { ...prev };
        
        Object.keys(newData).forEach((tabKey) => {
          newData[tabKey] = prev[tabKey].filter((task) => task.id !== selectedTaskId);
        });
        
        return newData;
      });
      
      toast("Due date removed");
      return;
    }

    setAllData((prev) => {
      const newData = { ...prev };

      Object.keys(newData).forEach((tabKey) => {
        newData[tabKey] = prev[tabKey].map((task) => {
          if (task.id === selectedTaskId) {
            return {
              ...task,
              dueDate: new Date(dueDate),
            };
          }
          return task;
        });
      });

      return newData;
    });

    toast.success("Due date updated!");
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

  const scrollToTask = (index: number, tasksArray?: ITask[]) => {
    const tasksToUse = tasksArray || allTasksFlat;
    document
      ?.getElementById(`inbox-${tasksToUse[index]?.id}`)
      ?.scrollIntoView({
        behavior: "smooth" as ScrollBehavior,
        block: "center",
      });
  };

  const updateSplitAndTasks = (index: number) => {
    setActiveSplit(index);
    const newGroupedTasks = groupTasksByDueDate(allData[tabs[index]] ?? []);
    setGroupedTasks(newGroupedTasks);
    setSelectedIndex(0);
    scrollToTask(0);
  };

  useEffect(() => {
    const currentTab = tabs[activeSplit];
    const newGroupedTasks = groupTasksByDueDate(allData[currentTab] ?? []);
    setGroupedTasks(newGroupedTasks);

    if (selectedTaskIdRef.current) {
      const taskIdToFind = selectedTaskIdRef.current;
      const newAllTasksFlat = getAllTasksFlat(newGroupedTasks);
      const newIndex = newAllTasksFlat.findIndex(
        (task) => task.id === taskIdToFind
      );

      if (newIndex !== -1) {
        setSelectedIndex(newIndex);
        updateActiveItemAndItemInView(newAllTasksFlat[newIndex]);
        setTimeout(() => {
          scrollToTask(newIndex, newAllTasksFlat);
        }, 0);
      }
      selectedTaskIdRef.current = null;
    }
  }, [allData, activeSplit, tabs]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    allTasksFlat,
    showCommands.show,
    selectedIndex,
    lastgClick,
    activeSplit,
    allData,
    controller,
  ]);

  return (
    <>
      <div
        suppressHydrationWarning
        onClick={(e) => setSelectedIndex(0)}
        autoFocus={false}
        className={`py-9 min-h-screen bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex  linksModal  ${styles.links_modal}`}
      >
        <div className={` flex gap-5 px-[16px] @md:!px-[88px]`}>
          <span className={`flex gap-1 font-bold text-subheading text-white-black`}>
            <p>Tasks with Due Dates</p>
          </span>
        </div>
        <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-[78px] @lg:px-[73px] mt-4">
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
              {Object.entries(groupedTasks).map(([groupKey, group]) => (
                <div key={groupKey} className="date-group">
                  <div className="px-4 @md:px-16 top-0 backdrop-blur-sm py-2 z-10 text-gray-400">
                    <h3 className="text-content font-bold uppercase">
                      {group.label}
                    </h3>
                  </div>

                  <div className="">
                    {group.tasks.map((task, i) => {
                      const globalIndex = group.startIndex + i;
                      const selected =
                        allTasksFlat[selectedIndex]?.id === task.id;
                      const isOverdue = groupKey === "Overdue";

                      return (
                        <div key={`${groupKey}-${i}`}>
                          <TaskListRow
                            task={task}
                            index={globalIndex}
                            handleLinkClick={handleLinkClick}
                            handleMouseEnter={handleMouseEnter}
                            handleMouseLeave={handleMouseLeave}
                            selected={selected}
                            showDueDate={true}
                            isOverdue={isOverdue}
                            key={`list-row-scheduled-tasks-${globalIndex}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none  @md:gap-8 w-100 bg-hoverCardBackground  h-20 @md:h-8 inbox_title">
          {tabs.map((item, index) => (
            <SplitTitle
              key={`split-scheduled-${index}`}
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
      <BackButton />
      {showCommands.show && (
        <HypertasksCommands
          callbackHandler={(payload, mode) => {
            if (mode === "DueDate") {
              updateDueDate(payload);
            }
          }}
        />
      )}
    </>
  );
};

export default AllDueDates;
