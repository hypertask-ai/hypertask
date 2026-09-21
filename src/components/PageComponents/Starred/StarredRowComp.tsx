/* eslint-disable react/jsx-key */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { useRecoilState } from "@/lib/state";
import {
  activeItemAtom,
  showCommandsAtom,
  tasksPlayListAtom,
  inViewObjectAtom,
} from "@/store";
import { IComment, ISavedContent, ITask, IUser } from "@/models/model";
import { scrollToCenterIfNearBottom } from "@/utils/helperFunctions/helperFunctions";
import globalConstants from "@/lib/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import useCopyURL from "@/hooks/General/useCopyURL";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { shareLinkRoute } from "@/lib/constants/APIRouteConstants";
import axios from "axios";
import toast from "react-hot-toast";
import { SavedContentRow } from "./SavedContentRow";
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";

const StarredRow = ({
  _savedContent,
  _currentUser,
  _starType,
}: {
  _savedContent: ISavedContent[];
  _currentUser: IUser;
  _starType: "Comment" | "Task";
}) => {
  const currentHoveredDiv = useRef<number | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const taskRef = useRef<HTMLDivElement>(null);
  const lastgClick = useRef<number | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  const [____, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [___, setActiveItem] = useRecoilState(activeItemAtom);
  const [_, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [showCommands, __] = useRecoilState(showCommandsAtom);

  const [savedContent, setSavedContent] =
    useState<ISavedContent[]>(_savedContent);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const router = useRouter();
  const isApple = useDeviceContext();
  const { starTask, pinComment, removeFromStarredContentQuery } =
    useStarAndPin();
  const { archiveNotificationGetter } = useGlobalFocusHandler();
  const {
    copyTaskURL,
    copyTaskFormattedURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
  } = useCopyURL();
  const { goToProjectShortcut } = useProjectQuery();

  const handleKeyUp = (e: KeyboardEvent) => {
    if (controller[e.keyCode]) {
      controller[e.keyCode].pressed = false;
    }
  };

  const handleKeyDown = async (e: KeyboardEvent) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (controller[e.keyCode]) {
      controller[e.keyCode].pressed = true;
    }

    const classNamesToReturnFrom = [
      "modal-open",
      "ProseMirror ProseMirror-focused",
      undefined,
    ];

    if (
      showCommands.show ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === "modalButtons" ||
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === "htc" ||
      classNamesToReturnFrom.includes(document?.activeElement?.className) ||
      document.activeElement?.id === "boardManager"
    )
      return;

    // [e][cmdControl] for archive task(keyCode 69 = 'e')
    if (e.keyCode === KeyCodes.E && cmdControl) {
      e.preventDefault();
      if (!shouldRunArchiveShortcut(e)) return;
      return archiveTaskHandler();
    }

    // [e] for archive notifications (keyCode 69 = 'e')
    if (e.keyCode === KeyCodes.E && !cmdControl && _starType === "Task") {
      e.preventDefault();
      if (savedContent && savedContent.length > 0)
        return archiveNotificationHandler();
    }

    // [j] for down (keyCode 74 = 'j') or ArrowDown (keyCode 40)
    if (e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN)
      ArrowDownHandler();

    // [k] for up (keyCode 75 = 'k') or ArrowUp (keyCode 38)
    if (e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP)
      ArrowUpHandler();

    // [enter] (keyCode 13)
    if (e.keyCode === KeyCodes.ENTER && savedContent && savedContent.length > 0)
      openTask(
        savedContent[selectedIndex].task,
        savedContent[selectedIndex].comment
      );

    // cmd/ctrl + m (keyCode 77 = 'm')
    if (e.keyCode === KeyCodes.M && cmdControl) {
      e.preventDefault();
      openTask(savedContent[selectedIndex].task, undefined, undefined, true);
    }

    // [alt][v]
    else if (e.keyCode === KeyCodes.V && e.altKey && !e.shiftKey) {
      e.preventDefault();
      openTask(savedContent[selectedIndex].task, undefined, true);
    }

    // --- G key sequence handling start ---

    // Helper: check if a g-sequence is available and matches a target key
    const gSequenceActive = () => {
      const now = new Date().getTime();
      return (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      );
    };

    // [g] then [g]: Jump to top/bottom row
    if (
      controller[KeyCodes.G]?.pressed &&
      e.keyCode === KeyCodes.G &&
      gSequenceActive() &&
      savedContent.length > 0
    ) {
      lastgClick.current = null;
      if (e.shiftKey) {
        // Go to bottom task
        setSelectedIndex(savedContent.length - 1);
        updateActiveItemAndItemInView(
          savedContent[savedContent.length - 1].task
        );
        scrollToRow(savedContent.length - 1);
      } else {
        // Go to top task
        setSelectedIndex(0);
        updateActiveItemAndItemInView(savedContent[0].task);
        scrollToRow(0);
      }
      // Prevent further G combos after this triggers
      return;
    }

    // [g] then [t]: Go to project page
    if (
      controller[KeyCodes.T]?.pressed &&
      e.keyCode === KeyCodes.T &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      goToProjectShortcut(savedContent[selectedIndex].projectId, true);
      // Prevent further G combos after this triggers
      return;
    }

    // [g] then [i]: Go to inbox
    if (
      controller[KeyCodes.I]?.pressed &&
      e.keyCode === KeyCodes.I &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      router.push(globalConstants.inboxRoute);
      // Prevent further G combos after this triggers
      return;
    }

    // [g] then [d]: Go to drafts
    if (
      controller[KeyCodes.D]?.pressed &&
      e.keyCode === KeyCodes.D &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      router.push(globalConstants.draftsRoute);
      return;
    }

    // [g] then [u]: Go to scheduled tasks
    if (
      controller[KeyCodes.U]?.pressed &&
      e.keyCode === KeyCodes.U &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      router.push("/scheduled");
      return;
    }

    // [g] - capture sequence initiation only if previous was NOT part of a combo
    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay);
      return; // Do not let a plain [g] fall through to other handlers
    }

    // --- G key sequence handling end ---

    //[cmdControl][shift][,]
    if (
      e.keyCode === KeyCodes.SEMICOLON &&
      cmdControl &&
      e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskURL(
        savedContent[selectedIndex].task?.uniqueIndex,
        savedContent[selectedIndex].task?.projectId
      );
    }
    //[cmdControl][,]
    if (
      (e.keyCode === KeyCodes.SEMICOLON || e.keyCode === KeyCodes.COMMA) &&
      cmdControl &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      return copyTaskFormattedURL(
        savedContent[selectedIndex].task?.title!,
        savedContent[selectedIndex].task?.ticketNumber!,
        savedContent[selectedIndex].task?.uniqueIndex,
        savedContent[selectedIndex].task?.projectId
      );
    }

    //[cmdControl][shift][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler();
    }

    //[cmdControl][.]
    if (e.keyCode === KeyCodes.PERIOD && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler(true);
    }

    //[cmdControl][I]
    if (e.keyCode === KeyCodes.I && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return copyTitleAndTicketNumber(
        savedContent[selectedIndex].task?.title!,
        savedContent[selectedIndex].task?.ticketNumber!
      );
    }

    //[cmdControl][i]
    if (e.keyCode === KeyCodes.I && cmdControl && e.shiftKey) {
      e.preventDefault();
      return copyTicketNumber(savedContent[selectedIndex].task?.ticketNumber!);
    }

    // [cmd][shift][s]
    if (
      e.keyCode === KeyCodes.S &&
      cmdControl &&
      e.shiftKey &&
      !e.altKey &&
      _starType === "Comment"
    ) {
      e.preventDefault();
      if (savedContent && savedContent.length > 0) return handleStarring();
    }

    // [alt][s]
    if (
      e.keyCode === KeyCodes.S &&
      e.altKey &&
      !e.shiftKey &&
      _starType === "Task"
    ) {
      e.preventDefault();
      if (savedContent && savedContent.length > 0) return handleStarring();
    }
  };

  /**
 *This function is generalized for (un)star tasks/comments
 Depending on the starType, the relevant function will run
 Reponse status && _starType determines toast message
 */
  const handleStarring = async () => {
    let response: any;
    if (_starType === "Comment") {
      response = await pinComment(
        savedContent[selectedIndex].taskId,
        savedContent[selectedIndex].projectId,
        savedContent[selectedIndex].comment?.id!,
        "Private"
      );
    } else {
      response = await starTask(
        savedContent[selectedIndex].taskId,
        savedContent[selectedIndex].projectId,
        true
      );
    }

    if (response.status === 201) {
      removeFromStarredContentQuery(savedContent[selectedIndex], _starType);
      // Get the current item
      const currentItem = savedContent[selectedIndex];

      // Generate toast message based on type
      const itemLabel =
        _starType === "Comment"
          ? `Comment-${currentItem.comment?.id!}`
          : `Task ${currentItem.task.ticketNumber?.toUpperCase()}`;

      // Show toast with appropriate message
      toast(`Unstarred ${itemLabel}`);
    }
  };

  const archiveNotificationHandler = () => {
    const savedRow = savedContent[selectedIndex];
    if (
      savedRow?.task?.notifications &&
      savedRow.task.notifications?.length > 0
    ) {
      archiveNotificationGetter(
        savedRow.task.notifications[0],
        "Notification",
        null
      );
      setSavedContent((prev) =>
        prev.map((item) => {
          if (item.taskId === savedRow.taskId) {
            return {
              ...item,
              task: {
                ...item.task,
                notifications: [],
              },
            };
          }
          return item;
        })
      );
      toast("Notifications archived");
    }
  };

  const archiveTaskHandler = () => {
    if (savedContent && savedContent.length > 0)
      if (savedContent[selectedIndex]) {
        if (selectedIndex >= 0) {
          if (selectedIndex === savedContent.length - 1) {
            setSelectedIndex((prev) => prev - 1);
            updateActiveItemAndItemInView(savedContent[selectedIndex - 1].task);
          }
          archiveTask(savedContent[selectedIndex].task, selectedIndex);
        }
      }
  };

  // [j] for down
  const ArrowDownHandler = () => {
    if (savedContent && savedContent.length > 0)
      if (savedContent[selectedIndex]) {
        const index = savedContent.findIndex(
          (task) => task.id === savedContent[selectedIndex].id
        );
        if (index === -1 || index === savedContent.length - 1) {
        } else {
          setSelectedIndex((prev) => prev + 1);
          updateActiveItemAndItemInView(savedContent[selectedIndex + 1].task);
          scrollToRow(selectedIndex + 1);
        }
      } else {
        if (savedContent.length > 0) {
          setSelectedIndex(0);
          updateActiveItemAndItemInView(savedContent[0].task);
          scrollToRow(0);
        }
      }
  };

  const scrollToRow = (index: number) =>
    document
      .getElementById(`task-row-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  // [k] for up
  const ArrowUpHandler = () => {
    if (savedContent && savedContent.length > 0)
      if (savedContent[selectedIndex]) {
        const index = savedContent.findIndex(
          (task) => task.id === savedContent[selectedIndex].id
        );
        if (index <= 0) {
        } else {
          setSelectedIndex((prev) => prev - 1);
          updateActiveItemAndItemInView(savedContent[selectedIndex - 1].task);
          scrollToRow(selectedIndex - 1);
        }
      } else {
        if (savedContent.length > 0) {
          setSelectedIndex(savedContent.length - 1);
          updateActiveItemAndItemInView(
            savedContent[savedContent.length - 1].task
          );
          scrollToRow(savedContent.length - 1);
        }
      }
  };

  const openTask = async (
    task: ITask | null,
    comment?: IComment,
    audio?: boolean,
    reply?: boolean
  ) => {
    if (!task) return;
    let route: string;
    if (comment && _starType === "Comment") {
      const index = task.comments?.findIndex((item) => comment.id === item.id);
      if (!index || index === -1) return;
      route = `/detail/project-${task.projectId}/${task.uniqueIndex}#comment-${index}`;
    } else {
      route = `/detail/project-${task.projectId}/${task.uniqueIndex}`;
      route = route + (reply ? "?reply=true" : audio ? "?audio=true" : "");
    }
    updateActiveItemAndItemInView(task);
    router.push(route);
  };
  /**
   *This function is for archiving/unarchiving a task
   * @todo Update this function to deal with cache insstead of state.
   * @param {ITask} task
   * @param {number} index
   */
  const archiveTask = async (task: ITask, index: number) => {
    try {
      await fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTask: {
            id: task.id,
            status: task.status === "Archive" ? "Normal" : "Archive",
          },
        }),
      });
      // queryClient.refetchQueries({
      //   queryKey: ["Saved starred for [userId]:", _currentUser.id],
      // });
      setSavedContent((prev) =>
        prev.map((item) => {
          if (item.taskId === task.id) {
            return {
              ...item,
              task: {
                ...item.task,
                status: task.status === "Archive" ? "Normal" : "Archive",
              },
            };
          }
          return item;
        })
      );
      toast(task.status === "Archive" ? "Unarchived task" : "Archived task");
    } catch (error) {
      console.log("🚀 ~ markAsUnarchive ~ error:", error);
    }
  };

  const shareTaskHandler = async (formatted: boolean = false) => {
    const response = await axios.post(shareLinkRoute, {
      userId: _currentUser?.id,
      taskId: savedContent[selectedIndex].task.id,
      projectId: savedContent[selectedIndex].task.projectId,
    });

    if (response.status === 200) {
      const data = response.data.data;
      if (formatted)
        copySharedTaskFormattedURL(
          data.id,
          savedContent[selectedIndex].task.title!,
          savedContent[selectedIndex].task.ticketNumber!
        );
      else copySharedTaskURL(data.id);
    }
  };

  const handleMouseEnter = (index: number) =>
    (currentHoveredDiv.current = index);

  const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && taskRef.current) {
        (taskRef.current as HTMLDivElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  };

  const handleMouseMove = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      setSelectedIndex(
        currentHoveredDiv.current ? currentHoveredDiv.current : 0
      );
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
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

  useEffect(() => {
    if (savedContent && savedContent.length > 0) {
      const elementToScrollTo = document.getElementById(
        `task-${savedContent[selectedIndex].id}`
      );
      updateActiveItemAndItemInView(savedContent[selectedIndex].task);
      elementToScrollTo && scrollToCenterIfNearBottom(elementToScrollTo);

      const tasksPlayList: any = savedContent?.map((item) => ({
        projectId: item.task.projectId,
        uniqueIndex: item.task.uniqueIndex,
      }));

      setTasksPlayList(tasksPlayList);
    }

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    lastgClick.current,
    savedContent,
    selectedIndex,
    showCommands,
    controller,
  ]);

  useEffect(() => {
    setSavedContent(_savedContent);
  }, [_savedContent]);

  return (
    <>
      <div
        onMouseMove={handleMouseMove}
        className="flex-1 flex w-full flex-col pb-20 md:pb-0"
      >
        {savedContent?.map((item: ISavedContent, index: number) => (
          <SavedContentRow
            index={index}
            taskRef={taskRef}
            openTask={openTask}
            handleMouseLeave={handleMouseLeave}
            handleMouseEnter={handleMouseEnter}
            selected={savedContent[selectedIndex]?.id === item.id}
            task={item.task}
            updatedAt={item.task?.updatedAt ?? ""}
            buttonClick={handleStarring}
            starType={_starType}
            comment={item.comment ?? undefined}
            archiveNotificationHandler={archiveNotificationHandler}
          />
        ))}
      </div>
    </>
  );
};

export default StarredRow;
