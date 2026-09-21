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
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import {
  convertToPlain,
  scrollToCenterIfNearBottom,
  scrollToCenterIfNearTop,
} from "@/utils/helperFunctions/helperFunctions";
import globalConstants from "@/lib/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import useCopyURL from "@/hooks/General/useCopyURL";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import toast from "react-hot-toast";
import { shareLinkRoute } from "@/lib/constants/APIRouteConstants";
import { SavedContentRow } from "../Starred/SavedContentRow";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";

const PinnedCommentsContainer = ({
  _savedContent,
  _currentUser,
  _pinType,
}: {
  _savedContent: ISavedContent[];
  _currentUser: IUser;
  _pinType: "Team" | "Personal";
}) => {
  const currentHoveredDiv = useRef<number | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const taskRef = useRef<HTMLDivElement>(null);
  const lastgClick = useRef<number | null>(null);

  const [____, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [___, setActiveItem] = useRecoilState(activeItemAtom);
  const [_, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [showCommands, __] = useRecoilState(showCommandsAtom);

  const [savedContent, setSavedContent] =
    useState<ISavedContent[]>(_savedContent);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const queryClient = useQueryClient();
  const router = useRouter();
  const isApple = useDeviceContext();
  const { pinComment, removeFromPinnedContentQuery, addToPinnedContentQuery } =
    useStarAndPin();
  const {
    copyTaskURL,
    copyTaskFormattedURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
  } = useCopyURL();
  const { goToProjectShortcut } = useProjectQuery();
  const { navigateToTask } = useHypertasksNavigate()
  const handleKeyDown = async (e: KeyboardEvent) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
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

    // [e] for archive (keyCode 69 = 'e')
    if (e.keyCode === 69 && cmdControl) {
      e.preventDefault();
      eHandler();
    }

    // [j] for down (keyCode 74 = 'j') or ArrowDown (keyCode 40)
    if (e.keyCode === 74 || e.keyCode === 40) ArrowDownHandler();

    // [k] for up (keyCode 75 = 'k') or ArrowUp (keyCode 38)
    if (e.keyCode === 75 || e.keyCode === 38) ArrowUpHandler();

    // [enter] (keyCode 13)
    if (e.keyCode === 13)
      openTask(
        savedContent[selectedIndex].task,
        savedContent[selectedIndex].comment!
      );

    // g (keyCode 71 = 'g')
    if (e.keyCode === 71) gPressHandler();

    // b (keyCode 66 = 'b')
    if (e.keyCode === 66) gThenB();

    // i (keyCode 73 = 'i')
    if (e.keyCode === 73) gThenI();

    // t (keyCode 84 = 't')
    if (e.keyCode === 84) gThenT();

    //[cmdControl][shift][,]
    if (e.keyCode === 188 && cmdControl && e.shiftKey && !e.altKey) {
      e.preventDefault();
      return copyTaskURL(
        savedContent[selectedIndex].task?.uniqueIndex,
        savedContent[selectedIndex].task?.projectId
      );
    }
    //[cmdControl][,]
    if (e.keyCode === 188 && cmdControl && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      return copyTaskFormattedURL(
        savedContent[selectedIndex].task?.title!,
        savedContent[selectedIndex].task?.ticketNumber!,
        savedContent[selectedIndex].task?.uniqueIndex,
        savedContent[selectedIndex].task?.projectId
      );
    }

    //[cmdControl][shift][.]
    if (e.keyCode === 190 && cmdControl && e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler();
    }

    //[cmdControl][.]
    if (e.keyCode === 190 && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return shareTaskHandler(true);
    }

    //[cmdControl][I]
    if (e.keyCode === 73 && cmdControl && !e.shiftKey) {
      e.preventDefault();
      return copyTitleAndTicketNumber(
        savedContent[selectedIndex].task?.title!,
        savedContent[selectedIndex].task?.ticketNumber!
      );
    }

    //[cmdControl][shift][i]
    if (e.keyCode === 73 && cmdControl && e.shiftKey) {
      e.preventDefault();
      return copyTicketNumber(savedContent[selectedIndex].task?.ticketNumber!);
    }

    // [cmdControl][shift][p]
    if (e.keyCode === 80 && cmdControl && e.shiftKey && !e.altKey) {
      e.preventDefault();
      return handlePinComment();
      return handlePinComment();
    }
  };

  const handlePinComment = async () => {
    const response = await pinComment(
      savedContent[selectedIndex].taskId,
      savedContent[selectedIndex].projectId,
      savedContent[selectedIndex].comment?.id!,
      "Public"
    );
    if (response.status === 200) {
      addToPinnedContentQuery(response.data, _pinType);
      toast(
        `Starred Task ${savedContent[
          selectedIndex
        ].task.ticketNumber?.toUpperCase()}`
      );
    } else {
      removeFromPinnedContentQuery(savedContent[selectedIndex], _pinType);
      setSavedContent((prev) =>
        prev.filter((item) => item.id !== prev[selectedIndex].id)
      );
      toast(
        `Comment-${savedContent[selectedIndex].comment?.id!} has been unpinned`
      );
    }
  };

  // [e] for unarchive
  const eHandler = () => {
    if (savedContent[selectedIndex]) {
      if (selectedIndex >= 0) {
        if (selectedIndex === savedContent.length - 1) {
          setSelectedIndex((prev) => prev - 1);
          updateActiveItemAndItemInView(savedContent[selectedIndex - 1].task);
        }
        markAsUnarchive(savedContent[selectedIndex].task, selectedIndex);
      }
    }
  };

  // [j] for down
  const ArrowDownHandler = () => {
    if (savedContent[selectedIndex]) {
      const index = savedContent.findIndex(
        (task) => task.id === savedContent[selectedIndex].id
      );
      if (index === -1 || index === savedContent.length - 1) {
      } else {
        setSelectedIndex((prev) => prev + 1);
        const activeElement = document.getElementById(
          `task-${savedContent[index + 1].id}`
        );
        updateActiveItemAndItemInView(savedContent[selectedIndex + 1].task);
        activeElement && scrollToCenterIfNearBottom(activeElement);
      }
    } else {
      if (savedContent.length > 0) {
        setSelectedIndex(0);
        updateActiveItemAndItemInView(savedContent[0].task);
        document
          .getElementById(`task-${savedContent[0].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // [k] for up
  const ArrowUpHandler = () => {
    if (savedContent[selectedIndex]) {
      const index = savedContent.findIndex(
        (task) => task.id === savedContent[selectedIndex].id
      );
      if (index <= 0) {
      } else {
        setSelectedIndex((prev) => prev - 1);
        updateActiveItemAndItemInView(savedContent[selectedIndex - 1].task);
        const activeElement = document.getElementById(
          `task-${savedContent[index - 1].id}`
        );
        activeElement && scrollToCenterIfNearTop(activeElement);
      }
    } else {
      if (savedContent.length > 0) {
        setSelectedIndex(savedContent.length - 1);
        updateActiveItemAndItemInView(
          savedContent[savedContent.length - 1].task
        );
        document
          .getElementById(`task-${savedContent[savedContent.length - 1].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // [g]
  const gPressHandler = () => {
    const now = new Date().getTime();
    lastgClick.current = now;
  };

  // g->i
  const gThenI = () => {
    const now = new Date().getTime();
    if (lastgClick.current && now - lastgClick.current < 5000) {
      lastgClick.current = null;
      router.push(globalConstants.inboxRoute);
    }
  };

  // g->t
  const gThenB = () => {
    const now = new Date().getTime();
    if (lastgClick.current && now - lastgClick.current < 5000) {
      lastgClick.current = null;
      goToProjectShortcut(savedContent[selectedIndex].projectId, true);
    }
  };

  // g->h
  const gThenT = () => {
    const now = new Date().getTime();
    if (lastgClick.current && now - lastgClick.current < 5000) {
      lastgClick.current = null;
      router.push(globalConstants.timersRoute);
    }
  };

  const openTask = async (task: ITask | null, comment?: IComment) => {
    if (!task) return;
    if(!comment) return
    const index = task.comments?.findIndex((item) => comment.id === item.id);
    if (!index || index === -1) return;
    updateActiveItemAndItemInView(task);
    navigateToTask(task.projectId, task.uniqueIndex)
    
  };

  const markAsUnarchive = async (task: ITask, index: number) => {
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
      queryClient.refetchQueries({
        queryKey: ["Saved pinned for [userId]:", _currentUser.id],
      });
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

  // const getCommentIndex = (savedContent: ISavedContent) => {
  //   const itemIndex = savedContent.task.comments?.findIndex(
  //     (taskComment) =>
  //       taskComment.id.toString() === savedContent.comment?.id?.toString()
  //   );

  //   return itemIndex;
  // };

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
        // commentHash: getCommentIndex(item),
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
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    lastgClick.current,
    savedContent,
    savedContent[selectedIndex],
    showCommands,
  ]);

  useEffect(() => {
    setSavedContent(_savedContent);
  }, [_savedContent]);

  return (
    <>
      <div
        onMouseMove={handleMouseMove}
        style={{
          flex: 1,
          display: "flex",
          width: "100%",
          flexDirection: "column",
        }}
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
            updatedAt={item.task.updatedAt ?? ""}
            comment={item.comment!}
            buttonClick={handlePinComment}
            starType={"Comment"}
            pinComments={true}
          />
        ))}
      </div>
    </>
  );
};

export default PinnedCommentsContainer;
