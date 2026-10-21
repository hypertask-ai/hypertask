import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import MarkTaskAsDone from "./MarkTaskAsDone";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext, useMemo } from "react";
import ArchiveTaskNotification from "./ArchiveTaskNotifications";
import RemindMeTaskDetail from "./RemindMeTaskDetail";
import useArchiveAndNavigate from "@/hooks/Task Detail/useArchiveAndNavigate";
import ShareTaskButton from "./ShareTaskButton";
import HTCButton from "./HTCButton";
import { getTaskDetailHeaderActions } from "@/lib/taskDetailArchiveActions";

const TaskOptions = () => {
  const { currentTask } = useTaskContext();
  const { markAsDone, navigateToNextTask } = useArchiveAndNavigate();
  const hasNotifications = !!(
    currentTask?._count?.notifications && currentTask?._count?.notifications > 0
  );
  const _mbl = useContext(MobileViewContext);
  const headerActions = getTaskDetailHeaderActions({
    hasNotifications,
    isMobile: _mbl,
  });

  if (_mbl) {
    return (
      <div className="flex gap-2" data-task-detail-primary-actions="true">
        <ShareTaskButton />
        {headerActions.includes("archive") && (
          <MarkTaskAsDone markAsDone={markAsDone} />
        )}
      </div>
    );
  }

  else
    return (
      <div
        className="flex items-center gap-[16px] mt-[9.75px] self-start"
        data-task-detail-primary-actions="true"
      >
        <ShareTaskButton />
        {headerActions.includes("remove-notification") && (
          <ArchiveTaskNotification
            selected={true}
            navigateToNextTask={navigateToNextTask}
          />
        )}

        {headerActions.includes("archive") && (
          <MarkTaskAsDone markAsDone={markAsDone} />
        )}

        <RemindMeTaskDetail
          color="#696b6e"
          hoverText="#95999E"
          navigateToNextTask={navigateToNextTask}
          remindTask={hasNotifications}
        />
        <HTCButton />
      </div>
    );
};

export default TaskOptions;
