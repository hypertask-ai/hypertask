import { useFlag } from "@/hooks/useFlag";
import { HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_7349_TITLE_CLEAR_OF_NAV_FLAG, HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG } from "@/lib/flags/keys";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useEffect, useRef, useState } from "react";
import { updateTask } from "@/utils/api/Task Detail";
import toast from "react-hot-toast";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import {
  currentUserAtom,
  showCommandsAtom,
  showAIChatInterfaceAtom,
  aiChatSidebarWidthPxAtom,
} from "@/store";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import ConfirmModal from "@/components/Modals/Common Modals/ConfirmActionModal";
import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useDebounce from "@/hooks/General/useDebounce";
import Tooltip from "@/components/Common/Tooltip";
import { CommandMode } from "@/models/enums";
import { Circle } from "lucide-react";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import RunningTimerIndicator from "./RunningTimerIndicator";
const TaskTitle = () => {
  const {
    parsedTask: parsed_task,
    editMode,
    setEditMode,
    focusOn,
    currentTask,
    setCurrentTask,
    descriptionStart,
  } = useTaskContext();
  const descriptionFirstFlag = useFlag(HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG);
  const titleSizedBeforeHydration = descriptionFirstFlag || descriptionStart === "server";
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const titleClearOfNavFlag = useFlag(HTPR_7349_TITLE_CLEAR_OF_NAV_FLAG);
  const _parsedTask = JSON.parse(parsed_task);
  const _mbl = useContext(MobileViewContext);
  const [__, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [, setCommands] = useRecoilState(showCommandsAtom);
  const { navigate } = useHypertasksNavigate();
  const { updateTaskInCache } = UpdateKanban();
  const [confirm, setConfirm] = useState<boolean>(false);
  const isApple = useDeviceContext();
  const [value, setValue] = useState<string>(_parsedTask.title);
  const [ready, setReady] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const debounceSave = useDebounce(() => {
    handleTitleSave();
  }, 2000);

  const onChangeTitle = (e: any) => {
    setValue(e.target.value);
    debounceSave();
  };

  useClickOutside(null, shouldConfirmAction, "title");
  const showAiChatInterface = useRecoilValue(showAIChatInterfaceAtom);
  const aiChatSidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);
  useAutosizeTextArea(
    textAreaRef,
    value,
    undefined,
    `${showAiChatInterface}:${aiChatSidebarWidthPx}:${titleClearOfNavFlag}`
  );

  const handleTitleSave = (cmdCtrlEnterPressed?: boolean) => {
    const previousTitle = currentTask?.title ?? _parsedTask.title;
    const taskId = currentTask?.id ?? null;
    const projectId = currentTask?.projectId ?? null;
    const sectionId = currentTask?.sectionId;

    const rollbackTitle = () => {
      setCurrentTask((old) => (old ? { ...old, title: previousTitle } : old));
      updateTaskInCache({ title: previousTitle }, taskId, projectId, sectionId);
      setValue(previousTitle);
      toast.error("Failed to update task title.");
    };

    try {
      const newTask = {
        title: value,
        id: currentTask?.id,
      };

      setCurrentTask((old) => (old ? { ...old, title: value } : old));
      updateTaskInCache({ title: value }, taskId, projectId, sectionId);
      if (cmdCtrlEnterPressed) setValue(value);
      if (cmdCtrlEnterPressed) {
        toast("Task updated successfully!");
        focusOn(descriptionContainerId);
        setEditMode(null);
      }

      if (!taskId || taskId === -1) return;

      updateTask(newTask)
        .then((response) => {
          if (response.status != 200) rollbackTitle();
        })
        .catch((error) => {
          console.error(error);
          rollbackTitle();
        });
    } catch (error) {
      console.error(error);
      rollbackTitle();
    }
  };

  function shouldConfirmAction() {
    if (confirm || editMode !== "title") return;
    if (currentTask?.id === -1) {
      setTimeout(() => {
        setConfirm(true);
      }, 200);
    } else titleEscapeHandler();
  }

  function titleEscapeHandler(shouldNavigateBack?: boolean) {
    if (currentTask?.id === -1) {
      setConfirm(false);
      if (shouldNavigateBack) navigate("Back");
      else if (!shouldNavigateBack) {
        focusOn("title-input");
        setEditMode("title");
      }
    } else {
      setEditMode(null);
      focusOn("title");
    }
  }

  useEffect(() => {
    if (editMode === "title" && textAreaRef.current)
      textAreaRef.current.focus();
  }, [editMode]);

  useEffect(() => {
    setValue(currentTask?.title ?? _parsedTask.title);
    setReady(true);
  }, [currentTask?.title, _parsedTask.title]);

  return (
    <div
      className="flex items-center gap-2 relative group"
      tabIndex={0}
      id="title"
      style={{ flex: 1 }}
    >
      {currentTask?.savedContent && currentTask?.savedContent?.length > 0 ? (
        <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification mt-[9.75px] self-start"  strokeWidth={1.75} fill="currentColor"/>
      ) : (
        <></>
      )}
      <textarea
        ref={textAreaRef}
        rows={1}
        tabIndex={0}
        id="title-input"
        readOnly={!ready}
        value={value ?? ""}
        onFocus={(e) => {
          e.target.selectionStart = e.target.value.length;
        }}
        onDoubleClick={() => {
          focusOn("title");
          setEditMode("title");
        }}
        onChange={onChangeTitle}
        onKeyDown={(e) => {
          var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleTitleSave(true);
            return;
          }
          if (!_mbl) {
            if (e.keyCode === 74 && cmdControl) {
              e.preventDefault();
              if (editWithAiEnabled) {
                setCommands({ show: true, mode: CommandMode.Command, paletteTab: "compose" });
                return;
              }
              focusOn("description");
              document
                .getElementById("popover-wrapper-" + "description")
                ?.scrollIntoView({ behavior: "smooth", block: "end" });
              setEditMode("description-ai");
              return true;
            }
          }

          if (e.key === "Escape" && editMode === "title")
            return shouldConfirmAction();
        }}
        className="font-bold"
        style={{
          resize: "none",
          background: "transparent",
          fontSize: !_mbl ? 24 : 16,
          width: "100%",
          outline: "none",
          ...(titleSizedBeforeHydration ? { fieldSizing: "content", minHeight: 37 } : {}),
        }}
      />
      {currentTask?.id && currentTask.id > 0 && currentTask.project?.timeTrackingEnabled ? (
        <RunningTimerIndicator taskId={currentTask.id} />
      ) : null}
      <Tooltip
        left={15}
        bottom={-35}
        text="Edit title"
        keyCombination={["F2"]}
      />
      {confirm && (
        <ConfirmModal
          header="Leave page"
          content="You have unsaved changes. Are you sure you want to leave this page?"
          confirmButtonContent="Confirm"
          onConfirm={() => titleEscapeHandler(true)}
          onCancel={() => titleEscapeHandler(false)}
        />
      )}
    </div>
  );
};

export default TaskTitle;
