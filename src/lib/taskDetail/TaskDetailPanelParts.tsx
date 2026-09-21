import dynamic from "next/dynamic";
import { instrumentedDynamicImport } from "@/lib/analytics/taskDetailPhaseTimings";
import { showAIChatInterfaceAtom, isAiChatSidebarModeAtom } from "@/store";
import { ArrowLeft } from "lucide-react";
import { useRecoilState } from "@/lib/state";
import taskDetailConfig from "@/lib/configs/taskDetail.config";

export const KeyboardShortcuts = dynamic(
  instrumentedDynamicImport("KeyboardShortcuts", () => import("@/components/sidebars/keyboardShortcuts")),
  { ssr: false }
);

export const DeleteCommentById = dynamic(
  instrumentedDynamicImport("DeleteCommentById", () => import("@/components/Modals/commands/DeleteCommentById")),
  { ssr: false }
);

export const NewCommentComponent = dynamic(
  instrumentedDynamicImport(
    "NewCommentComponent",
    () =>
      import(
        "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent"
      ),
  )
);

export const TaskMovement = dynamic(
  instrumentedDynamicImport("TaskMovement", () => import("@/components/PageComponents/TaskDetail/TaskMovement"))
);

export const Tooltip = dynamic(instrumentedDynamicImport("Tooltip", () => import("@/components/Common/Tooltip")), {
  ssr: false,
});

export const AttachmentCarousel = dynamic(
  instrumentedDynamicImport("AttachmentCarousel", () => import("@/components/Common/AttachmentsView/AttachmentsCarousel")),
  { ssr: false }
);

export const ConfirmTaskDelete = dynamic(
  instrumentedDynamicImport("ConfirmTaskDelete", () => import("@/components/Modals/confirmDeleteModals/confirmtTaskDelete"))
);

export const MoveTaskGlobal = dynamic(
  instrumentedDynamicImport("MoveTaskGlobal", () => import("@/components/Modals/MoveTaskToBoard"))
);

export const DesktopNavigation = ({
  onGoback,
  navigateToNextTask,
  navigateToPreviousTask,
  currentItemInTasksPlaylist,
  appShellRail,
  left,
}: {
  onGoback: () => void;
  navigateToNextTask: any;
  navigateToPreviousTask: any;
  appShellRail?: boolean;
  left?: number | string;
  currentItemInTasksPlaylist: {
    projectId: number;
    uniqueIndex: any;
  };
}) => {
  const [showAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [isSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
  return (
    <div
      // className="fixed  flex gap-2  items-center  flex-col xl:flex-row xl:left-10 left-5"
      className={`fixed  flex gap-2  items-center  flex-col left-3 ${
        showAiChatInterface && isSidebarMode ? "" : "xl:flex-row"
      } ${showAiChatInterface && isSidebarMode ? "" : "xl:left-10"}`}
      style={{
        zIndex: 51,
        top: taskDetailConfig.dimensions.desktopNavigation.top,
        left,
        justifyContent: "center",
      }}
    >
      <div
        id={taskDetailConfig.elementIds.taskDetailPageBackButton}
        onClick={onGoback}
        style={{
          width: taskDetailConfig.dimensions.backButton.size,
          height: taskDetailConfig.dimensions.backButton.size,
          borderRadius: taskDetailConfig.dimensions.backButton.borderRadius,
        }}
        className={`cursor-pointer justify-center items-center flex group ${
          appShellRail
            ? "text-text-light-gray hover:text-white-black"
            : "bg-back-button text-button-arrow shadow-md border-light-black-border-4"
        }`}
      >
        <ArrowLeft size={18} strokeWidth={1.75}/>
        <Tooltip left={taskDetailConfig.dimensions.tooltip.leftOffset} bottom={taskDetailConfig.dimensions.tooltip.bottomOffset} text="Back" keyCombination={[...taskDetailConfig.keyboard.escapeCombination]} />
      </div>
      <TaskMovement
        currentItemInTasksPlaylist={currentItemInTasksPlaylist}
        navigateToNextTask={navigateToNextTask}
        navigateToPreviousTask={navigateToPreviousTask}
      />
    </div>
  );
};
