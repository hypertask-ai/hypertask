"use client"
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ReactNode, useCallback, useRef } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import {
  DELIBERATE_DOUBLE_CLICK_MS,
  descriptionContainerId,
} from "@/lib/constants/TaskDetail";
import { useDoubleTap } from "@/hooks/MultiPages/useDoubleTap";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { isGuestUser } from "@/lib/demo/guest";
import {
  dispatchGuestDescriptionEditRequest,
  GUEST_DESCRIPTION_EDITOR_ID,
  GUEST_DESCRIPTION_INTERACTIVE_TARGET,
  shouldEnterGuestDescriptionEdit,
} from "@/lib/demo/guestDescriptionEdit";

const DescriptionContainer = (
  {
    children
  }: {
    children: ReactNode
  }
) => {
  const _mbl = useContext(MobileViewContext);
  const currentUser = useRecoilValue(currentUserAtom);
  const isGuest = isGuestUser(currentUser);
  const { editMode, setCurrentId, currentId, setEditMode, focusOn, hasDraft, hasDraftInit, currentTask } = useTaskContext();
  // const [description, setDescription] = useState<string>(_parsedTask?.description_.content);

  const enterDescriptionEditMode = useCallback(() => {
    setEditMode("description");
    // descriptionRef.current?.focus()
    focusOn(GUEST_DESCRIPTION_EDITOR_ID, false);
    !_mbl && document.getElementById(descriptionContainerId)?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [_mbl, focusOn, setEditMode]);
  const editDescriptionHandler = useCallback(() => {
    if (editMode === "description" || editMode === "description-ai") return
    setTimeout(enterDescriptionEditMode, 100);
  }, [editMode, enterDescriptionEditMode])
  const editGuestDescriptionHandler = useCallback(() => {
    if (
      editMode === "description" ||
      editMode === "description-ai" ||
      !currentTask?.id
    ) return;

    dispatchGuestDescriptionEditRequest(window, {
      taskId: currentTask.id,
      editorId: GUEST_DESCRIPTION_EDITOR_ID,
    });
    // React flushes this discrete-event state update before the next keyboard
    // event, so the guest does not inherit the established 100ms delay.
    enterDescriptionEditMode();
  }, [currentTask?.id, editMode, enterDescriptionEditMode]);
  // const [descriptionAttachments, setDescriptionAttachments] = useState<IAttachment[]>(_parsedTask?.description_?.attachments??[]);
  const handleDoubleTap = useCallback(
    () => {
      editDescriptionHandler();
    },
    [editDescriptionHandler]
  );
  const bind = useDoubleTap(handleDoubleTap, 200, { onSingleTap: () => setCurrentId(descriptionContainerId) });

  // HTPR-4659: same edit trigger as a comment. One detector, not two: a plain
  // click selects, and only a deliberate double click opens the editor.
  const pressStartRef = useRef(0);
  const rememberPressStart = useCallback((event: React.MouseEvent) => {
    if (event.detail <= 1) pressStartRef.current = event.timeStamp;
  }, []);
  const handleDesktopDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (isGuest) return;
      // Two unhurried clicks are two single clicks, whatever the OS says.
      if (event.timeStamp - pressStartRef.current > DELIBERATE_DOUBLE_CLICK_MS)
        return;
      editDescriptionHandler();
    },
    [editDescriptionHandler, isGuest]
  );
  const selectDescription = useCallback(
    () => setCurrentId(descriptionContainerId),
    [setCurrentId]
  );
  const handleDesktopClick = useCallback(
    (event: React.MouseEvent) => {
      selectDescription();

      const target = event.target;
      const isEditorSurface =
        target instanceof Element &&
        target.closest("#description-input") !== null;
      const isInteractiveTarget =
        target instanceof Element &&
        target.closest(GUEST_DESCRIPTION_INTERACTIVE_TARGET) !== null;

      if (
        shouldEnterGuestDescriptionEdit({
          isGuest,
          isMobile: _mbl,
          clickCount: event.detail,
          isEditorSurface,
          isInteractiveTarget,
        })
      ) {
        editGuestDescriptionHandler();
      }
    },
    [_mbl, editGuestDescriptionHandler, isGuest, selectDescription]
  );

  return (
    <div
      tabIndex={0}
      id={descriptionContainerId}
      {...(_mbl
        ? { ...bind }
        : {
            onMouseDownCapture: rememberPressStart,
            onClick: handleDesktopClick,
            onDoubleClick: handleDesktopDoubleClick,
          })}
      className={`
      group/descriptionContainer
      text-emphasis 
                     
      ${descriptionContainerId}
      ${_mbl ? "py-2 my-3" : "pt-[20px] pb-1 mb-[8px] px-[16px]"
        }
      shadow-md rounded-[4px]   w-full bg-comment-description outline-none ${hasDraft || hasDraftInit ? 'shadow-2xl border-l-[#C2CFA5]' :
          [descriptionContainerId, "description", "description-input"].includes(
            currentId!
          )
            ? `shadow-2xl ${(editMode === "description" || editMode === "description-ai")
              ? `border-l-[#C2CFA5]`
              : "border-l-selected-item-border"
            }`
            : "border-l-transparent"
        }`}
      style={{ borderLeftWidth: !_mbl ? 4 : 0 }}
    >
      {children}
    </div>
  );
};

export default DescriptionContainer;
