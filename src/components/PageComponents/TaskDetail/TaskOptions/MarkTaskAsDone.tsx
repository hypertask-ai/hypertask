import Tooltip from "@/components/Common/Tooltip";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { type KeyboardEvent, useContext, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7749_HEADER_ICON_SIZE_FLAG } from "@/lib/flags/definitions/htpr-7749-header-icon-size";
import { TOUCH_HALO } from "@/lib/configs/general.config";
import {
  getTaskArchiveAction,
  getTaskArchiveVisualState,
  type TaskArchiveAction,
} from "@/lib/taskDetailArchiveControl";

const MarkTaskAsDone = (
    {
        markAsDone
    }:{
        markAsDone: () => Promise<void>
    }
)=>{
    const headerIconSizeEnabled = useFlag(HTPR_7749_HEADER_ICON_SIZE_FLAG);
    const _mbl = useContext(MobileViewContext);
    const isApple = useDeviceContext()
    const{currentTask}=useTaskContext()
    const [pendingAction, setPendingAction] =
      useState<TaskArchiveAction | null>(null);
    const currentAction = getTaskArchiveAction(currentTask?.status);
    const { isArchived, label: archiveLabel } = getTaskArchiveVisualState(
      currentTask?.status,
      pendingAction,
    );
    const handleArchive = async () => {
      if (pendingAction) return;

      setPendingAction(currentAction.action);
      try {
        await markAsDone();
      } finally {
        setPendingAction(null);
      }
    };
    const stopArchiveEnterPropagation = (
      event: KeyboardEvent<HTMLButtonElement>,
    ) => {
      if (event.key === "Enter") event.stopPropagation();
    };

    const archiveIcon = (
      <CircleCheck
        aria-hidden="true"
        size={headerIconSizeEnabled ? 16 : 20}
        strokeWidth={1.75}
        className={`${headerIconSizeEnabled ? "" : "keep-stroke "}task-option-icon ${
          isArchived
            ? "task-archived-indicator text-[var(--color-archived-state)]"
            : "text-[#696b6e] group-hover:text-[var(--color-archived-state)]"
        }`}
      />
    );

    return(
        _mbl ? (
            <div
              className="h-8 w-8 flex items-center justify-center bg-back-button rounded-full group"
            >
              <button
                id="markAsDone"
                aria-label={archiveLabel}
                aria-busy={!!pendingAction}
                disabled={!!pendingAction}
                onClick={() => void handleArchive()}
                onKeyDown={stopArchiveEnterPropagation}
                className={`relative flex h-full w-full items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline ${TOUCH_HALO}`}
              >
                {archiveIcon}
              </button>
            
            </div>
          ) : (
            <div className="relative group flex h-[26px] items-center">
              <button
                id="markAsDone"
                aria-label={archiveLabel}
                aria-busy={!!pendingAction}
                disabled={!!pendingAction}
                onClick={() => void handleArchive()}
                onKeyDown={stopArchiveEnterPropagation}
                className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-container-outline"
              >
                {archiveIcon}
              </button>
              <Tooltip 
                left={-200}
                bottom={-45}
                text={archiveLabel}
                keyCombination={[`${!isApple?"CTRL":"CMD"}` ,"E"]}
                />
            </div>
          )
    )
}
export default MarkTaskAsDone
