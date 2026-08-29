import { useCallback, useEffect, useRef, useState } from "react";
import globalConstants from "@/lib/constants";
import toast from "react-hot-toast";
import Tooltip from "@/components/Common/Tooltip";
import TimeLogModal from "@/components/Modals/TimeLog/TimeLogModal";
import { useTaskTime, useTimerNow } from "@/hooks/Task Detail/useTimeTracking";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { formatElapsed } from "@/lib/timeDuration";
import { OPEN_TASK_TIME_LOG_EVENT } from "@/lib/timeLogModal";
import { LocalRightSideInfo, TaskInfoRow, TaskInfoValue } from "../MainPageComponents";

export { formatElapsed, useTimerNow };

const TaskTime = ({
  taskId,
  ticketId,
  title,
}: {
  taskId: number;
  ticketId: string;
  title: string;
}) => {
  const [showTimeLog, setShowTimeLog] = useState(false);
  const timer = useTaskTime(taskId);
  const runningEntry = timer.data?.runningEntry;
  const activeRunningEntryCount = timer.data?.activeRunningEntryCount ?? 0;
  const now = useTimerNow(activeRunningEntryCount > 0);
  const runningSeconds = runningEntry
    ? Math.floor(
        ((runningEntry.pausedAt ? new Date(runningEntry.pausedAt).getTime() : now) -
          new Date(runningEntry.startedAt).getTime()) /
          1000
      )
    : 0;
  const taskTotalSeconds =
    (timer.data?.taskTotalSeconds ?? 0) +
    activeRunningEntryCount *
      Math.max(0, Math.floor((now - timer.dataUpdatedAt) / 1000));
  // Server-computed: everything on the ticket except this run. Showing the
  // total when there is none just repeats the running timer (HTPR-4701).
  const hasHistory = (timer.data?.otherEntriesSeconds ?? 0) > 0;
  const timerRef = useRef(timer);
  timerRef.current = timer;
  // G-chord guard: [g] then [b] is "go to board" (GloablProviders), so a
  // pending g must keep plain [b] from opening the time log (DBAC-13). Same
  // pattern as RemindMeTaskDetail's g-then-h guard.
  const lastgClick = useRef<number | null>(null);

  const toggle = useCallback(async () => {
    try {
      await timerRef.current.toggle();
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update timer");
    }
  }, []);

  useEffect(() => {
    const openTimeLog = () => {
      if (timer.data?.enabled === false) return;
      setShowTimeLog(true);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const activeElementId = document.activeElement?.id ?? "";
      const isTyping =
        !!target?.closest("input, textarea, select") ||
        !!target?.closest('[contenteditable="true"]');
      if (
        event.key === "g" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTyping
      ) {
        lastgClick.current = Date.now();
        setTimeout(() => {
          lastgClick.current = null;
        }, globalConstants.gThenKeyDelay);
        return;
      }
      if (
        (event.key !== "b" && event.key !== "w") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        isTyping ||
        activeElementId === descriptionContainerId ||
        activeElementId.startsWith("comment") ||
        document.querySelector(".modal")
      )
        return;

      if (event.key === "w") {
        if (
          timer.isToggling ||
          (timer.data?.enabled === false && !runningEntry)
        )
          return;
        event.preventDefault();
        void toggle();
        return;
      }

      if (timer.data?.enabled === false) return;
      if (lastgClick.current !== null) return; // g pending: [g][b] navigates
      event.preventDefault();
      setShowTimeLog(true);
    };

    window.addEventListener(OPEN_TASK_TIME_LOG_EVENT, openTimeLog);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(OPEN_TASK_TIME_LOG_EVENT, openTimeLog);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [runningEntry, timer.data?.enabled, timer.isToggling, toggle]);

  const hideTimeRow =
    timer.data &&
    !timer.data.enabled &&
    timer.data.taskTotalSeconds === 0 &&
    !timer.data.runningEntry;

  return (
    <>
      {!hideTimeRow && (
        <TaskInfoRow>
          <LocalRightSideInfo
            title="Time"
            left={0}
            bottom={-40}
            tooltipText=""
            KeyCombination={[]}
            showTooltip={false}
          />
          <TaskInfoValue className="w-full">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2">
                {runningEntry && (
                  <span className="text-hypertasks-green">
                    {formatElapsed(runningSeconds)}
                  </span>
                )}
                {/* Total only once earlier time exists: with no history it just
                    repeats the running timer's own number (HTPR-4701). */}
                {hasHistory && (
                  <span className="relative group inline-flex">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label="Open time log"
                      className={
                        runningEntry
                          ? "text-text-light-gray hover:text-white-black"
                          : "text-white-black hover:text-text-light-gray"
                      }
                      onClick={() => setShowTimeLog(true)}
                    >
                      {formatElapsed(taskTotalSeconds)}{runningEntry ? " total" : ""}
                    </button>
                    <Tooltip
                      portal
                      left={0}
                      bottom={-40}
                      text="Time log"
                      keyCombination={["B"]}
                    />
                  </span>
                )}
                {(timer.data?.enabled !== false || runningEntry) && (
                  <span className="relative group inline-flex">
                    <button
                      type="button"
                      className="text-text-light-gray hover:text-white-black"
                      disabled={timer.isToggling}
                      onClick={toggle}
                    >
                      {runningEntry ? "Stop" : "Start"}
                    </button>
                    <Tooltip
                      portal
                      left={0}
                      bottom={-40}
                      text={runningEntry ? "Stop timer" : "Start timer"}
                      keyCombination={["W"]}
                    />
                  </span>
                )}
                {timer.data?.enabled !== false && (
                  <span className="relative group inline-flex">
                    <button
                      type="button"
                      className="text-text-light-gray hover:text-white-black"
                      onClick={() => setShowTimeLog(true)}
                    >
                      Log time
                    </button>
                    <Tooltip
                      portal
                      left={0}
                      bottom={-40}
                      text="Log time"
                      keyCombination={["B"]}
                    />
                  </span>
                )}
              </div>
            </div>
          </TaskInfoValue>
        </TaskInfoRow>
      )}
      {showTimeLog && (
        <TimeLogModal
          taskId={taskId}
          ticketId={ticketId}
          title={title}
          onClose={() => setShowTimeLog(false)}
        />
      )}
    </>
  );
};

export default TaskTime;
