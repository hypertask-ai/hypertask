import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useEffect, useRef, useState } from "react";
import { updateTask } from "@/utils/api/Task Detail";
import toast from "react-hot-toast";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import {
  currentUserAtom,
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
  } = useTaskContext();
  const _parsedTask = JSON.parse(parsed_task);
  const _mbl = useContext(MobileViewContext);
  const [__, _setCurrentUser] = useRecoilState(currentUserAtom);
  const { navigate } = useHypertasksNavigate();
  const { updateTaskInCache } = UpdateKanban();
  const [confirm, setConfirm] = useState<boolean>(false);
  const isApple = useDeviceContext();
  const [value, setValue] = useState<string>(_parsedTask.title);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const debounceSave = useDebounce(() => {
    handleTitleSave();
  }, 2000);

  const onChangeTitle = (e: any) => {
    setValue(e.target.value);
    debounceSave();
  };

  useClickOutside(null, shouldConfirmAction, "title");
  // Opening/closing (or resizing) the AI chat sidebar changes the title's wrap
  // width; feed that as a resize trigger so the textarea height recomputes and
  // doesn't stay stuck at the old width, overlapping the body (HTPR-4321).
  const showAiChatInterface = useRecoilValue(showAIChatInterfaceAtom);
  const aiChatSidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);
  useAutosizeTextArea(
    textAreaRef.current,
    value,
    undefined,
    `${showAiChatInterface}:${aiChatSidebarWidthPx}`
  );

  // ---------------------- SAVE TITLE -------------------
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

      // Unsaved draft (id -1): the task doesn't exist server-side yet, so a PUT
      // would 404. Skip the network save + rollback — the create flow persists
      // it; here we only keep the local/optimistic title.
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
        // setTimeout(() => {
        focusOn("title-input");
        setEditMode("title");
        // }, 100);
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

  // Neccessary Evil
  useEffect(() => {
    setValue(currentTask?.title ?? _parsedTask.title);
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
        tabIndex={0}
        id="title-input"
        value={value ?? ""}
        onFocus={(e) => {
          e.target.selectionStart = e.target.value.length;
          //setTrigger(prev=>!prev)
        }}
        onDoubleClick={() => {
          focusOn("title");
          setEditMode("title");
        }}
        onChange={onChangeTitle}
        onKeyDown={(e) => {
          var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
          if (_mbl) {
            if (e.key === "Enter") handleTitleSave(true);
          } else {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
              handleTitleSave(true);
            // [cmd/ctrl][j]
            if (e.keyCode === 74 && cmdControl) {
              e.preventDefault();
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
