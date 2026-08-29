import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useGetTaskShareLinks } from "@/hooks/Task Detail/useGetShareLinks";
import useCopyURL from "@/hooks/General/useCopyURL";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import useHandleKeydownBasic from "@/hooks/General/useHandleKeydownBasic";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { getTaskOptions } from "@/lib/constants/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { CommandMode } from "@/models/enums";
import { ITask, ITaskOption, TTaskOptionType } from "@/models/model";
import { currentProjectAtom, showCommandsAtom } from "@/store";
import { Status } from "@prisma/client";
import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Check, Clock, Link, Share2 } from "lucide-react";


import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
const prefixId = "label-htc-option-";

interface ITaskOptionsModal {
  toggle: () => void;
  navigateToNextTask?: (
    archiveNotification?: boolean,
    shouldNavigate?: boolean,
    remindMe?: boolean,
    force?: "forceNavigate",
    inboxFlow?: string | null
  ) => string | undefined;
  toggleDelete?: () => void;
  toggleRemind?: () => void;
  markTaskAsDone?: (forceNavigate?: boolean) => void;
  currentTask: ITask | null;
  isKanban: boolean;
  archiveNotification?: () => void;
  toggleRemoveSubtask: () => void;
  removeParentCallback: () => void;
  handleStarTask: () => void;
  followHandler: any;
  unfollowHandler: any;
}

const TaskOptionsModal = (props: ITaskOptionsModal) => {
  const {
    toggle,
    navigateToNextTask,
    toggleDelete,
    toggleRemind,
    markTaskAsDone,
    currentTask,
    isKanban,
    archiveNotification,
    toggleRemoveSubtask,
    removeParentCallback,
    handleStarTask,
    followHandler,
    unfollowHandler,
  } = props;
  const isApple = useDeviceContext();
  const { updateTaskInCache } = UpdateKanban();
  const currentUser = useCurrentUser();
  const [keyword, setKeyword] = useState<string>("");
  const hasNotifications = useMemo(() => {
    if (
      currentTask?._count?.notifications &&
      currentTask?._count?.notifications > 0
    )
      return true;
    else return false;
  }, [currentTask?._count?.notifications]);

  const hasSubtasks = useMemo(() => {
    if (currentTask?.subTasks && currentTask?.subTasks.length > 0) return true;
    else return false;
  }, [currentTask?.subTasks]);

  const options = useMemo(
    () =>
      getTaskOptions(
        isApple,
        currentTask?.status === "Archive",
        hasNotifications,
        isKanban,
        hasSubtasks,
        !!currentTask?.parentTaskId,
        !!(currentTask?.savedContent && currentTask?.savedContent?.length > 0)
      ),
    [currentTask]
  );
  //   const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { setSelectedIndex, selectedIndex, handleKeydown } =
    useHandleKeydownBasic(enterHandler);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });
  const [filteredOptions, setFilteredOptions] =
    useState<ITaskOption[]>(options);
  const [defaultOptions, setDefaultOptions] = useState<ITaskOption[]>(options);
  const [_, setShowCommands] = useRecoilState(showCommandsAtom);
  const [currentProject, ___] = useRecoilState(currentProjectAtom);
  const { data: sharedLink } = useGetTaskShareLinks(
    currentTask?.id!,
    currentTask?.projectId!,
    currentUser?.id!
  );
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();

  const {
    copyTaskFormattedURL,
    copyTaskURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTicketNumber,
    copyTitleAndTicketNumber,
  } = useCopyURL();

  async function enterHandler(index: number) {
    {
      if (filteredOptions.length === 0) return;
      else {
        switch (filteredOptions[index].type) {
          case "ShareTask":
            toggle();
            return setShowCommands({
              show: true,
              mode: CommandMode.ShareTaskPublic,
            });
          case "CopyURL":
            toggle();
            return copyTaskURL(
              currentTask?.uniqueIndex,
              currentTask?.projectId
            );
          case "CopyFormattedURL":
            toggle();
            return copyTaskFormattedURL(
              currentTask?.title!,
              currentTask?.ticketNumber!,
              currentTask?.uniqueIndex,
              currentTask?.projectId
            );
          case "CopyShareURL":
            toggle();
            return copySharedTaskURL(sharedLink.link);
          case "CopyShareFormattedURL":
            toggle();
            return copySharedTaskFormattedURL(
              sharedLink.id,
              currentTask?.title!,
              currentTask?.ticketNumber!
            );
          case "CopyTaskID":
            toggle();
            return copyTicketNumber(currentTask?.ticketNumber!);
          case "CopyTaskTitleAndTicketNumber":
            toggle();
            return copyTitleAndTicketNumber(
              currentTask?.title!,
              currentTask?.ticketNumber!
            );
          case "MoveInbox":
            toggle();
            if (currentUser)
              return moveTaskToInbox(
                currentUser?.id,
                currentTask?.projectId!,
                currentTask?.id!
              );
          case "Delete":
            toggle();
            return toggleDelete && toggleDelete();
          case "Remind":
            toggle();
            return toggleRemind && toggleRemind();
          case "RemoveNotification":
            toggle();
            if (isKanban) return archiveNotification && archiveNotification();
            return navigateToNextTask && navigateToNextTask(true, true);
          case "Archive":
            toggle();
            return markTaskAsDone && markTaskAsDone();
          case "RemoveSubtask":
            toggle();
            return toggleRemoveSubtask();
          case "RemoveParent":
            toggle();
            return removeParentCallback();
          case "Star":
            toggle();
            return handleStarTask();
          case "Duplicate":
            toggle();
            return toggleCreateTaskGlobally(undefined, undefined, currentTask);
          case "Follow":
            toggle();
            if (isKanban) return followHandler(currentTask?.id);
            else
              return followHandler(
                Number(currentUser?.id),
                Number(currentTask?.id)
              );

          case "Unfollow":
            toggle();
            if (isKanban) return unfollowHandler(currentTask?.id);
            else return unfollowHandler();
          default:
            toggle();
            return;
        }
      }
    }
  }

  const moveTaskToInbox = async (
    userId: number,
    projectId: number,
    taskId: number
  ) => {
    const response = await axios.post("/api/notifications/moveTaskToInbox", {
      userId,
      projectId,
      taskId,
    });
    if (response.status === 200) {
      toast.success("Task moved to inbox");
      navigateToNextTask &&
        navigateToNextTask(true, true, true, "forceNavigate");

      const taskToReturn = { _count: { notifications: 1 } };
      updateTaskInCache(
        taskToReturn,
        taskId,
        projectId,
        currentTask?.sectionId,
        currentProject
      );
    }
  };

  const handleChange = (e: any) => {
    setKeyword(e.target.value);
    if (e.target.value.length === 0) {
      setFilteredOptions(defaultOptions);
    } else {
      const filtered = filteredOptions.filter((option) =>
        option.title.toLowerCase().includes(keyword.toLowerCase())
      );
      setFilteredOptions(filtered);
    }
    setSelectedIndex(0);
    document
      .getElementById(`${prefixId}${0}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useEffect(() => {
    const keydown = (e: any) =>
      handleKeydown(
        e,
        filteredOptions?.length ? filteredOptions?.length : 0,
        prefixId,
        toggle
      );
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filteredOptions?.length, handleKeydown]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="task-options-modal"
      toggle={toggle}
      shouldCloseOnClickOutside={true}
      className="font-bold sm:max-h-fit"
    >
      <ModalHeaderComp header={"Task Options"} className="px-[20px]" />
      <ModalBody className="p-0">
        <ModalInput
          onChange={handleChange}
          value={keyword}
          placeholder="Search for an option"
          autofocus={true}
        />
        <ModalListContainer
          handleMouseMove={handleMouseMove}
          id="task-options-modal-list-container"
          className="max-h-[240px]"
        >
          {filteredOptions.length > 0 &&
            filteredOptions?.map((item: ITaskOption, index: number) => (
              <ModalRowElementContainer
                key={`el-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={() => enterHandler(index)}
                id={`${prefixId}${index}`}
                index={index}
                commandRef={elRef}
                isSelected={selectedIndex === index}
              >
                <TaskOption option={item} taskStatus={currentTask?.status!} />
              </ModalRowElementContainer>
            ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

const TaskOption = ({
  option,
  taskStatus,
}: {
  option: ITaskOption;
  taskStatus: Status;
}) => {
  return (
    <div className=" w-full flex items-center justify-between">
      <div className="space-x-3 flex items-center">
        <span className="text-white-black font-medium">{option.title}</span>
        <IconForTaskOption type={option.type} taskStatus={taskStatus} />
      </div>
      <div>
        {option.key &&
          option.key?.map((item, index) => (
            <SingleKey
              key={`index-${index}-single-key-comment-options-${item}`}
              item={item}
            />
          ))}
      </div>
    </div>
  );
};

const SingleKey = ({ item }: { item: "CTRL" | string }) => {
  return (
    <kbd className="px-[6px] pt-[1px] text-content mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64] font-bold dark:border-gray-500">
      {item}
    </kbd>
  );
};

const IconForTaskOption = ({
  type,
  taskStatus,
}: {
  type: TTaskOptionType;
  taskStatus: Status;
}) => {
  const classname = useMemo(() => "text-content text-white-black", []);
  switch (type) {
    case "Archive":
      return (
        <Check strokeWidth={1.75}
          className={`text-white-black stroke-[4px]`}
          size={14}
          color={taskStatus === "Archive" ? "green" : "#8E9093"}
        />
      );
    case "CopyURL":
      return <Link strokeWidth={1.75} className="text-white-black" size={14} />;
    case "CopyFormattedURL":
      return <Link strokeWidth={1.75} className="text-white-black" size={14} />;
    case "Remind":
      return <Clock strokeWidth={1.75} className="text-white-black" size={14} />;
    case "ShareTask":
      return <Share2 strokeWidth={1.75} className="text-white-black" size={14} />;

    default:
      return <></>;
  }
};
export default TaskOptionsModal;
