import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import useTiptap from "@/components/RTE/Tiptap";
import {
  defaultOptions,
  getBoards,
  getSidebarInfo,
  moveColumns,
  multipleKeys,
  priorities,
  sceneStates,
  staticNotifications,
  staticSplitTitles,
  tutorialUsers,
} from "@/lib/constants/InteractiveOnboarding/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  IBoard,
  IBoardHeader,
  INotification,
  ISplitTitle,
  TTutorialPage,
} from "@/models/InteractiveOnboarding/model";
import { currentUserAtom, tutorialActiveSceneAtom } from "@/store";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRecoilState, useResetRecoilState } from "@/lib/state";
import { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { useScene } from "./useScenes";
import { updateUserSettingTutorial } from "@/lib/serverActions";
import nookies, { parseCookies } from "nookies";
import { PriorityConstants } from "@/lib/constants/constants";
import axios from "axios";
import { getSharedTaskRoute } from "@/lib/constants/APIRouteConstants";
import { IUser } from "@/models/model";
import useFunnelCookies from "../MultiPages/useFunnelCookies";
import toast from "react-hot-toast";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";

type TSceneHandler = { [key in string]: (e: KeyboardEvent) => void };

export const useTutorial = () => {
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  // Provide a dummy user for display purposes only
  const displayUser: IUser = currentUser ?? {
    id: 0,
    displayName: "You",
    email: "you-demo@hypertask.ai",
    photoURL:
      "https://ui-avatars.com/api/?name=John+Doe&background=0066cc&color=fff&size=150",
    UserSetting: { onboardingTutorialStatus: false },
  };

  const sidebarInfo = useMemo(() => getSidebarInfo(displayUser), []);
  const [showExit, setShowExit] = useState<boolean>(false);
  const [activeBoard, setActiveBoard] = useState(0);
  const [activeColumn, setActiveColumn] = useState(0);
  const [activeHint, setActiveHint] = useState<number>(0);
  const [activeModalIndex, setActiveModalIndex] = useState<number>(0);
  const [activeNotification, setActiveNotification] = useState(0);
  const [activeScene, setActiveScene] = useRecoilState(tutorialActiveSceneAtom);
  const [activeTask, setActiveTask] = useState(0);
  const [activeTaskPage, setActiveTaskPage] = useState(0);
  const [addColumnInput, setAddColumnInput] = useState("");
  const [exitURL, setExitURL] = useState<string>("");

  const [board, setBoard] = useState<IBoard>(
    getBoards(displayUser)[activeBoard]
  );
  const [assigneeInput, setAssigneeInput] = useState<string>("");
  const [filteredAssignees, setFilteredAssignees] = useState(tutorialUsers);
  const [commentInput, setCommentInput] = useState<string>("");
  const [filteredOptions, setFilteredOptions] =
    useState<(DisplayDate | undefined)[]>(defaultOptions);
  const [filterMoveColumnsOptions, setFilterMoveOptions] =
    useState<string[]>(moveColumns);
  const [filterPriorityOptions, setFilterPriorityOptions] =
    useState<any[]>(priorities);
  const [filteredSideBarOptions, setFilteredSideBarOptions] =
    useState<IBoardHeader[]>(sidebarInfo);
  const [moveTaskModalInput, setMoveTaskModalInput] = useState("");
  const [priorityModalInput, setPriorityInput] = useState("");
  const [notifications, setNotifications] =
    useState<INotification[]>(staticNotifications);
  const [remindMeModalInput, setRemindMeModalInput] = useState("");
  const resetActiveScene = useResetRecoilState(tutorialActiveSceneAtom);
  const [sceneState, setSceneState] =
    useState<{ [key in string]: any }>(sceneStates);
  const [shake, setShake] = useState(false);
  const [sideBarInput, setSideBarInput] = useState("");
  const [splitTitles, _] = useState<ISplitTitle[]>(staticSplitTitles);
  const [description, setDescription] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const lastGPress = useRef<number | null>(null);
  const { editor: commentEditor } = useTiptap({
    mode: "create-comment",
    defaultContent: commentInput,
  });
  const { editor: descriptionEditor } = useTiptap({
    mode: "read-edit-description",
    defaultContent: "",
  });
  const isApple = useDeviceContext();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { scenes } = useScene({
    sceneState,
    isApple,
  });
  // Funnel user detection
  const {
    isFunnelUser,
    isLoggedIn,
    isFunnelUserAndTutorialCompleted: funnelTutorialCompleted,
    markTutorialCompleted,
  } = useFunnelCookies();

  const exitTutorial = useCallback(async () => {
    if (!isLoggedIn && isFunnelUser) {
      // Funnel user flow - set completion cookie
      nookies.set(null, "funnel_tutorial_completed", "true", {
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      // Redirect to signup for funnel users
      router.push("/login");
      return;
    }

    if (isLoggedIn && !currentUser.UserSetting.onboardingTutorialStatus && activeScene.index === 33) {
      const newSetting: any = await updateUserSettingTutorial(
        currentUser.id,
        true
      );

      setCurrentUser((prev: any) => {
        const updatedUser = { ...prev, UserSetting: { ...newSetting } };
        nookies.set(
          null,
          "nookies_user",
          JSON.stringify(slimUserForCookie(updatedUser)),
          {
            maxAge: 600 * 60 * 24 * 7, // 1 week
            path: "/",
          },
        );
        return updatedUser;
      });
    }

    // Consume the onboarding-return cookie so a later standalone tutorial (Ctrl+K)
    // doesn't wrongly redirect back into the onboarding sequence.
    nookies.destroy(null, "onboarding_return", { path: "/" });

    console.log("Exit tutorial was called2");
    router.push(exitURL);
  }, [
    isLoggedIn,
    isFunnelUser,
    currentUser,
    setCurrentUser,
    router,
    exitURL,
    activeScene,
  ]);

  //------------------------------------------------MULTI KEY PRESS CONTROLLER
  const controller: { [key: number]: { pressed: boolean } } = useMemo(() => {
    return {
      ...multipleKeys,
    };
  }, []);

  //------------------------------------------------HINT SHAKE SETTER
  const errorShake = () => {
    setShake(true);
    setTimeout(() => {
      setShake(false);
    }, 500);
  };

  //------------------------------------------------INPUT HANDLERS
  const isInputValid = (input: string) => {
    const cleanedInput = input.replace(/\s+/g, "");
    return cleanedInput.length > 0;
  };

  const handleCommentInput = (content: string) => {
    setCommentInput(content);
    return undefined;
  };

  const handleMoveTaskInput = (e: any) => {
    setMoveTaskModalInput(e.target.value);
  };

  const handlePriorityInput = (e: any) => {
    setPriorityInput(e.target.value);
  };

  const handleAddColumnInput = (e: any) => {
    setAddColumnInput(e.target.value);
  };

  const handleSideBarInput = (e: any) => {
    setSideBarInput(e.target.value);
  };

  const handleAssigneeInput = (e: any) => {
    setAssigneeInput(e.target.value);
    const filtered = tutorialUsers.filter((option) =>
      option.name.toLowerCase().includes(e.target.value.toLowerCase())
    );
    setActiveModalIndex(0);
    setFilteredAssignees(filtered);
  };

  const handleRemindMeModalInput = (e: any) => {
    setRemindMeModalInput(e.target.value);
  };

  const handleCommandCallback = (e: ICommandList) => {
    if (e?.name === "Add board column") {
      updateScene(undefined, false, undefined);
    }
  };

  const AITaskWriterHandler = (
    s: string,
    proceed?: boolean,
    newTitle?: string
  ) => {
    if (descriptionEditor) descriptionEditor.commands.setContent(s);
    setDescription(s);
    if (proceed) updateScene(undefined, false, undefined);
    if (newTitle) setTitle(newTitle);
  };

  //------------------------------------------------SCENE UPDATERS
  const updateHint = useCallback(
    (increment: number = 1) => {
      setShake(false);
      setActiveHint((prev) => (prev + increment <= 0 ? 0 : prev + increment));
    },
    [shake, activeHint]
  );

  const updateScene = useCallback(
    (page: TTutorialPage, push: boolean, phase: number | undefined) => {
      setShake(false);
      setActiveHint(0);
      let url = `/interactive-onboarding/${
        page ?? activeScene.currPage
      }?scene=${activeScene.index + 1}`;

      if (page === "end" && isFunnelUser) {
        markTutorialCompleted();
        url += `&funnel_completed=true`;
      }

      const scenePhase = phase ?? activeScene.phase;
      setTimeout(() => {
        push
          ? setActiveScene((prev) => ({
              currPage: page,
              index: prev.index + 1,
              phase: scenePhase,
            }))
          : setActiveScene((prev) => ({
              ...prev,
              index: prev.index + 1,
              phase: scenePhase,
            }));
        push ? router.push(url) : router.replace(url);
        setActiveModalIndex(0);
      }, 100);
    },
    [activeScene, activeHint, shake]
  );

  //------------------------------------------------KEY HANDLERS
  const keyUpSceneHandlers: TSceneHandler = useMemo(
    () => ({
      scene3: (e: KeyboardEvent) => {
        if (sceneState.scene3.tabCount === 2 && e.keyCode === 16) {
          setSceneState((prevState) => ({
            ...prevState,
            scene3: {
              ...prevState.scene3,
              shiftPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
      scene5: (e: KeyboardEvent) => {
        if (e.keyCode === 17 && !sceneState.scene5.mPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene5: {
              ...prevState.scene5,
              ctrlPressed: false,
            },
          }));
          updateHint(-1);
        } else if (e.keyCode === 17 && sceneState.scene5.mPressed) {
          setActiveHint(0);
        }
      },
      scene6: (e: KeyboardEvent) => {
        var cmdControl = isApple ? [91, 93] : [17];
        if (cmdControl.includes(e.keyCode) && !sceneState.scene6.enterPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene6: {
              ...prevState.scene6,
              ctrlPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
      scene12: (e: KeyboardEvent) => {
        if (e.keyCode === 73 && lastGPress.current !== null) {
          updateHint(-1);
        }
      },
      scene19: (e: KeyboardEvent) => {
        e.preventDefault();
        var cmdControlKey = (isApple && 91) || (!isApple && 17);
        if (e.keyCode === cmdControlKey && !sceneState.scene19.bPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene19: {
              ...prevState.scene19,
              cmdCtrlPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
      scene21: (e: KeyboardEvent) => {
        e.preventDefault();
        var cmdControlKey = (isApple && 91) || (!isApple && 17);
        if (e.keyCode === cmdControlKey && !sceneState.scene21.kPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene21: {
              ...prevState.scene21,
              cmdCtrlPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
      scene26: (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.keyCode === 16 && !sceneState.scene26.lPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene26: {
              ...prevState.scene26,
              shiftPressed: false,
            },
          }));
          updateHint(-1);
        } else if (e.keyCode === 16 && sceneState.scene26.lPressed) {
          updateHint(-1);
        }
      },
      scene27: (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.keyCode === 16 && !sceneState.scene27.jPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene27: {
              ...prevState.scene27,
              shiftPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
      scene29: (e: KeyboardEvent) => {
        if (e.keyCode === 17 && !sceneState.scene29.dPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene29: {
              ...prevState.scene29,
              ctrlPressed: false,
            },
          }));
          updateHint(-1);
        } else if (e.keyCode === 17 && sceneState.scene29.dPressed) {
          setActiveHint(0);
        }
      },
      scene30: (e: KeyboardEvent) => {
        var cmdControl = isApple ? 91 : 17;
        if (e.keyCode === cmdControl && !sceneState.scene30.jPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene30: {
              ...prevState.scene30,
              ctrlPressed: false,
            },
          }));
          updateHint(-1);
        }
      },
    }),
    [sceneState, pathname, activeHint, activeScene, controller]
  );

  const keyDownSceneHandlers: TSceneHandler = useMemo(
    () => ({
      scene0: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Enter] pressed
        if (e.key === "Enter") {
          setSceneState((prevState) => ({
            ...prevState,
            scene0: !prevState.scene0,
          }));
          updateScene(undefined, false, 0);
        } else {
          errorShake();
        }
      },
      scene1: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Enter] pressed
        if (e.key === "Enter") {
          setSceneState((prevState) => ({
            ...prevState,
            scene1: !prevState.scene1,
          }));
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene2: (e: KeyboardEvent) => {
        e.preventDefault();
        //[j] pressed
        if (
          e.keyCode === 74 &&
          sceneState.scene2.jCount < 3 &&
          sceneState.scene2.kCount === 0
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene2: {
              ...prevState.scene2,
              jCount: prevState.scene2.jCount + 1,
            },
          }));
          setActiveTask((prev) => prev + 1);
          updateHint();
        }
        //[k] pressed
        else if (
          e.keyCode === 75 &&
          sceneState.scene2.jCount === 3 &&
          sceneState.scene2.kCount < 2
        ) {
          setActiveTask((prev) => prev - 1);
          updateHint();
          if (sceneState.scene2.kCount === 1)
            updateScene(undefined, false, undefined);
          setSceneState((prevState) => ({
            ...prevState,
            scene2: {
              ...prevState.scene2,
              kCount: prevState.scene2.kCount + 1,
            },
          }));
        } else {
          errorShake();
        }
      },
      scene3: (e: KeyboardEvent) => {
        e.preventDefault();
        //[tab] pressed
        if (
          controller[9]?.pressed &&
          !e.shiftKey &&
          sceneState.scene3.tabCount < 2
        ) {
          setActiveColumn((prev) => prev + 1);
          setSceneState((prevState) => ({
            ...prevState,
            scene3: {
              ...prevState.scene3,
              tabCount: prevState.scene3.tabCount + 1,
            },
          }));
          updateHint();
        }
        //[shift] pressed
        else if (
          sceneState.scene3.tabCount === 2 &&
          e.key === "Shift" &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene3: {
              ...prevState.scene3,
              shiftPressed: true,
            },
          }));
          updateHint();
          //[shift]+[tab]
        } else if (
          e.shiftKey &&
          controller[9]?.pressed &&
          sceneState.scene3.tabCount === 2
        ) {
          setActiveColumn((prev) => prev - 1);
          setSceneState((prevState) => ({
            ...prevState,
            scene3: {
              ...prevState.scene3,
              tabCount: prevState.scene3.tabCount + 1,
            },
          }));
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene4: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Enter] pressed
        if (e.key === "Enter") {
          setSceneState((prevState) => ({
            ...prevState,
            scene4: !prevState.scene4,
          }));
          updateScene("taskDetail", true, 1);
        } else {
          errorShake();
        }
      },
      scene5: (e: KeyboardEvent) => {
        e.preventDefault();
        if (!pathname?.startsWith("/interactive-onboarding/taskDetail")) return;
        //[ctrl] pressed
        if (
          e.key === "Control" &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene5: {
              ...prevState.scene5,
              ctrlPressed: true,
            },
          }));
          updateHint();
        }
        //[m] pressed
        else if (controller[77]?.pressed && e.ctrlKey) {
          setSceneState((prevState) => ({
            ...prevState,
            scene5: {
              mPressed: !prevState.scene5.mPressed,
              ctrlPressed: true,
            },
          }));
          if (commentEditor) commentEditor.commands.focus("end");
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene6: (e: KeyboardEvent) => {
        var cmdControl = isApple ? "Meta" : "Control";
        var cmdControlKey = isApple ? e.metaKey : e.ctrlKey;
        var notCmdControl = isApple ? e.ctrlKey : e.metaKey;
        var cmdControlAndEnterPressed = cmdControlKey && controller[13]?.pressed;
        var isCommentValid = isInputValid(commentInput) && commentInput;
        //[cmd/ctrl] pressed
        if (
          e.key === cmdControl &&
          cmdControlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !notCmdControl
        ) {
          e.preventDefault();
          setSceneState((prevState) => ({
            ...prevState,
            scene6: {
              ...prevState.scene6,
              ctrlPressed: true,
            },
          }));
          updateHint();
        }
        else if (cmdControlAndEnterPressed && !isCommentValid) {
          toast.error("Please type your comment first");
        }
        //[enter] pressed
        else if (isCommentValid && cmdControlAndEnterPressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene6: {
              enterPressed: !prevState.scene6.enterPressed,
              ctrlPressed: true,
            },
          }));
          setBoard((prev) => {
            const currentBoard = { ...prev };
            const boardTaskPages = [...currentBoard.taskPages];
            const currentTaskPage = {
              ...boardTaskPages[activeTaskPage],
            };
            const newComment = {
              createdBy: displayUser?.displayName!,
              imgSrc: displayUser?.photoURL!,
              text: commentInput,
              createdAt: "Just now",
            };
            const updatedComments = [...currentTaskPage.comments, newComment];
            const updatedCurrentTaskPage = {
              ...currentTaskPage,
              comments: updatedComments,
            };
            const updatedBoardTaskPages = [
              ...boardTaskPages.slice(0, activeTaskPage),
              updatedCurrentTaskPage,
              ...boardTaskPages.slice(activeTaskPage + 1),
            ];
            const newBoard = {
              ...currentBoard,
              taskPages: updatedBoardTaskPages,
            };
            return newBoard;
          });
          if (commentEditor) {
            commentEditor.commands.blur();
            commentEditor.commands.setContent("");
            setTimeout(() => {
              document
                ?.getElementById("comment-input-interactive")
                ?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
            }, 100);
          }
          updateScene(undefined, false, undefined);
        } else if (cmdControlKey && !controller[13]?.pressed) {
          errorShake();
        }
      },
      scene7: (e: KeyboardEvent) => {
        e.preventDefault();
        //[a] pressed
        if (e.keyCode === 65) {
          setSceneState((prevState) => ({
            ...prevState,
            scene7: !prevState.scene7,
          }));
          setActiveModalIndex(0);
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene8: (e: KeyboardEvent) => {
        if (e.keyCode === 40) {
          e.preventDefault();
          if (activeModalIndex + 1 <= filteredAssignees.length - 1)
            setActiveModalIndex((prev) => prev + 1);
        }
        if (e.keyCode === 38) {
          e.preventDefault();
          if (activeModalIndex - 1 >= 0)
            setActiveModalIndex((prev) => prev - 1);
        }
        //[Enter] pressed
        if (
          e.key === "Enter" &&
          filteredAssignees[activeModalIndex].name === tutorialUsers[1].name
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene8: !prevState.scene8,
          }));
          //update assignees if any.
          setBoard((prev) => {
            const updatedBoard = { ...prev };
            const updatedTaskPages = [...updatedBoard.taskPages];
            const currentPage = updatedTaskPages[activeTaskPage];
            const newCurrentPage = {
              ...currentPage,
              taskInfo: {
                ...currentPage.taskInfo,
                assignees: [
                  ...currentPage.taskInfo.assignees,
                  { name: tutorialUsers[1].name, pfp: tutorialUsers[1].pfp },
                ],
              },
            };
            updatedTaskPages[activeTaskPage] = newCurrentPage;

            return {
              ...updatedBoard,
              taskPages: updatedTaskPages,
            };
          });
          setTimeout(() => {
            document
              ?.getElementById("comment-input-interactive")
              ?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
          }, 100);
          updateScene(undefined, false, undefined);
        } else if (
          e.key === "Enter" &&
          filteredAssignees[activeModalIndex].name !== tutorialUsers[1].name
        ) {
          errorShake();
        }
      },
      scene9: (e: KeyboardEvent) => {
        e.preventDefault();
        //[p] pressed
        if (e.keyCode === 80) {
          setSceneState((prevState) => ({
            ...prevState,
            scene9: !prevState.scene9,
          }));
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene10: (e: KeyboardEvent) => {
        //[downArrow] pressed
        if (e.keyCode === 40) {
          if (activeModalIndex + 1 <= 4)
            setActiveModalIndex((prev) => prev + 1);
        }
        if (e.keyCode === 38) {
          if (activeModalIndex - 1 >= 0)
            setActiveModalIndex((prev) => prev - 1);
        }
        //[Enter] pressed
        if (
          e.key === "Enter" &&
          filterPriorityOptions[activeModalIndex].index === 1
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene10: !prevState.scene10,
          }));
          setBoard((prev) => {
            const updatedBoard = { ...prev };
            const updatedTaskPages = [...updatedBoard.taskPages];
            const currentPage = updatedTaskPages[activeTaskPage];
            const newCurrentPage = {
              ...currentPage,
              taskInfo: {
                ...currentPage.taskInfo,
                priority: PriorityConstants[1],
              },
            };
            updatedTaskPages[activeTaskPage] = newCurrentPage;

            return {
              ...updatedBoard,
              taskPages: updatedTaskPages,
            };
          });
          setTimeout(() => {
            document
              ?.getElementById("comment-input-interactive")
              ?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
          }, 100);
          updateScene(undefined, false, undefined);
        } else if (
          e.key === "Enter" &&
          filterPriorityOptions[activeModalIndex].index !== 1
        ) {
          errorShake();
        }
      },
      scene11: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Esc] pressed
        if (e.key === "Escape") {
          setSceneState((prevState) => ({
            ...prevState,
            scene11: !prevState.scene11,
          }));
          updateScene("landing", true, 2);
        } else {
          errorShake();
        }
      },
      scene12: (e: KeyboardEvent) => {
        if (!pathname?.startsWith("/interactive-onboarding/landing")) return;
        e.preventDefault();
        //[g] pressed
        if (e.keyCode === 71 && !lastGPress.current) {
          const now = new Date().getTime();
          lastGPress.current = now;
          setSceneState((prevState) => ({
            ...prevState,
            scene12: {
              ...prevState.scene12,
              gPressed: true,
            },
          }));
          updateHint();
          setTimeout(() => {
            lastGPress.current = null;
            setSceneState((prevState) => ({
              ...prevState,
              scene12: {
                ...prevState.scene12,
                gPressed: false,
              },
            }));
            setActiveHint(0);
            setShake(false);
          }, 500);
        }
        //[i] pressed
        else if (controller[73]?.pressed && lastGPress.current) {
          const now = new Date().getTime();
          if (now - lastGPress.current < 500) {
            lastGPress.current = null;
            setSceneState((prevState) => ({
              ...prevState,
              scene12: {
                ...prevState.scene12,
                iPressed: true,
              },
            }));
            setActiveTaskPage((prev) => prev + 1);
            updateScene("inbox", true, undefined);
          }
        } else {
          errorShake();
        }
      },
      scene13: (e: KeyboardEvent) => {
        if (!pathname?.startsWith("/interactive-onboarding/inbox")) return;
        e.preventDefault();
        //[j] pressed
        if (
          e.keyCode === 74 &&
          sceneState.scene13.jCount < 2 &&
          sceneState.scene13.eCount === 0 &&
          sceneState.scene13.kCount === 0
        ) {
          setActiveNotification((prev) => prev + 1);
          setSceneState((prevState) => ({
            ...prevState,
            scene13: {
              ...prevState.scene13,
              jCount: prevState.scene13.jCount + 1,
            },
          }));
          updateHint();
        }
        //[k] pressed
        else if (
          e.keyCode === 75 &&
          sceneState.scene13.kCount < 2 &&
          sceneState.scene13.eCount === 0 &&
          sceneState.scene13.jCount === 2
        ) {
          setActiveNotification((prev) => prev - 1);
          setSceneState((prevState) => ({
            ...prevState,
            scene13: {
              ...prevState.scene13,
              kCount: prevState.scene13.kCount + 1,
            },
          }));
          updateHint();
        }
        //[e] pressed
        else if (
          e.keyCode === 69 &&
          sceneState.scene13.jCount === 2 &&
          sceneState.scene13.kCount === 2 &&
          sceneState.scene13.eCount < 2
        ) {
          updateHint();
          if (sceneState.scene13.eCount === 1)
            updateScene(undefined, false, undefined);
          //setActiveNotification((prev) => prev - 1);
          setNotifications((prev) => {
            //we need to remove the current active notification
            const filtered = prev.filter(
              (item, index) => index !== activeNotification
            );
            return filtered;
          });
          setSceneState((prevState) => ({
            ...prevState,
            scene13: {
              ...prevState.scene13,
              eCount: prevState.scene13.eCount + 1,
            },
          }));
        } else {
          errorShake();
        }
      },
      scene14: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Enter] pressed
        if (e.key === "Enter") {
          setSceneState((prevState) => ({
            ...prevState,
            scene14: !prevState.scene14,
          }));
          updateScene("taskDetail", true, undefined);
        } else {
          errorShake();
        }
      },
      scene15: (e: KeyboardEvent) => {
        if (!pathname?.startsWith("/interactive-onboarding/taskDetail")) return;
        e.preventDefault();
        //[e] pressed
        if (e.keyCode === 69) {
          updateScene(undefined, false, undefined);
          setSceneState((prevState) => ({
            ...prevState,
            scene15: !prevState.scene15,
          }));
          setNotifications(
            (prev) => prev.slice(0, -1) // Removes the last element
          );
          setActiveTaskPage((prev) => prev + 1);
          setTimeout(() => {
            document
              ?.getElementById("comment-input-interactive")
              ?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
          }, 100);
        } else {
          errorShake();
        }
      },
      scene16: (e: KeyboardEvent) => {
        e.preventDefault();
        //[h] pressed
        if (e.keyCode === 72) {
          updateScene(undefined, false, undefined);
          setSceneState((prevState) => ({
            ...prevState,
            scene16: !prevState.scene16,
          }));
          setActiveModalIndex(0);
        } else {
          errorShake();
        }
      },
      scene17: (e: KeyboardEvent) => {
        //[downArrow] pressed
        if (e.keyCode === 40) {
          if (activeModalIndex + 1 <= filteredOptions.length - 1)
            setActiveModalIndex((prev) => prev + 1);
        }
        if (e.keyCode === 38) {
          if (activeModalIndex - 1 >= 0)
            setActiveModalIndex((prev) => prev - 1);
        }
        //[Enter] pressed
        if (e.key === "Enter") {
          e.preventDefault();
          if (
            remindMeModalInput.includes("tomorrow") ||
            filteredOptions[activeModalIndex]?.display === "tomorrow"
          ) {
            setSceneState((prevState) => ({
              ...prevState,
              scene17: !prevState.scene17,
            }));
            setNotifications(
              (prev) => prev.slice(0, -1) // Removes the last element
            );
            updateScene("inbox", true, undefined);
          } else {
            errorShake();
          }
        }
      },
      scene18: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Esc] pressed
        if (e.key === "Escape") {
          setSceneState((prevState) => ({
            ...prevState,
            scene18: !prevState.scene18,
          }));
          updateScene("landing", true, 3);
        } else {
          errorShake();
        }
      },
      scene19: (e: KeyboardEvent) => {
        if (!pathname?.startsWith("/interactive-onboarding/landing")) return;

        e.preventDefault();
        var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
        var cmdControlKey = (isApple && "Meta") || (!isApple && "Control");
        if (e.key === cmdControlKey && !e.shiftKey && !e.altKey) {
          setSceneState((prevState) => ({
            ...prevState,
            scene19: {
              ...prevState.scene19,
              cmdCtrlPressed: true,
            },
          }));
          updateHint();
        }
        //[b] pressed
        else if (cmdControl && controller[66]?.pressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene19: {
              bPressed: !prevState.scene19.bPressed,
              cmdCtrlPressed: true,
            },
          }));
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene20: (e: KeyboardEvent) => {
        //[downArrow] pressed
        if (e.keyCode === 40) {
          if (activeModalIndex + 1 <= filteredSideBarOptions.length - 1)
            setActiveModalIndex((prev) => prev + 1);
        }
        if (e.keyCode === 38) {
          if (activeModalIndex - 1 >= 0)
            setActiveModalIndex((prev) => prev - 1);
        }
        //[Enter] pressed
        if (e.key === "Enter") {
          e.preventDefault();
          if (
            sideBarInput.toLowerCase() === "product backlog" ||
            filteredSideBarOptions[activeModalIndex].title === "Product Backlog"
          ) {
            setSceneState((prevState) => ({
              ...prevState,
              scene20: !prevState.scene20,
            }));
            setActiveBoard((prev) => prev + 1);
            setBoard(getBoards(displayUser)[1]);
            setActiveColumn(0);
            setActiveTask(0);
            setActiveTaskPage(0);
            updateScene(undefined, false, 4);
          } else {
            errorShake();
          }
        }
      },
      scene21: (e: KeyboardEvent) => {
        e.preventDefault();
        var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
        var cmdControlKey = (isApple && "Meta") || (!isApple && "Control");
        if (e.key === cmdControlKey && !e.shiftKey && !e.altKey && cmdControl) {
          setSceneState((prevState) => ({
            ...prevState,
            scene21: {
              ...prevState.scene21,
              cmdCtrlPressed: true,
            },
          }));
          updateHint();
        }
        //[k] pressed
        else if (cmdControl && controller[75]?.pressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene21: {
              kPressed: !prevState.scene21.bPressed,
              cmdCtrlPressed: true,
            },
          }));
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene22: (e: KeyboardEvent) => {
        //reason why this is all commented out is because umm the scene for the Command Center
        //is being handled by CC itself. So you dont have to do anything.
        // //[Enter] pressed
        // if (e.key === "Enter") {
        //   e.preventDefault();
        //   const val=(document.getElementById('htc') as HTMLInputElement)?.value
        //   console.log("🚀 ~ useTutorial ~ val:", val)
        //   if (val?.toLowerCase() === "add column") {
        //     setSceneState((prevState) => ({
        //       ...prevState,
        //       scene22: !prevState.scene22,
        //     }));
        //     updateScene(undefined, false, undefined);
        //   } else {
        //     errorShake();
        //   }
        // }
      },
      scene23: (e: KeyboardEvent) => {
        //[Enter] pressed
        if (e.key === "Enter") {
          e.preventDefault();
          if (["done"].includes(addColumnInput.toLowerCase())) {
            setSceneState((prevState) => ({
              ...prevState,
              scene23: !prevState.scene23,
            }));
            setBoard((prev) => {
              //lets add a new board section here
              const newBoard = {
                ...prev,
                sections: [
                  ...prev.sections,
                  {
                    title: "Done",
                    tasks: [],
                    showBottomButton: false,
                  },
                ],
              };

              return newBoard;
            });
            updateScene(undefined, false, undefined);
          } else {
            errorShake();
          }
        }
      },
      scene24: (e: KeyboardEvent) => {
        //[m] pressed
        if (e.keyCode === 77) {
          e.preventDefault();
          setSceneState((prevState) => ({
            ...prevState,
            scene24: !prevState.scene24,
          }));
          setActiveModalIndex(0);
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene25: (e: KeyboardEvent) => {
        //[downArrow] pressed
        if (e.keyCode === 40) {
          if (activeModalIndex + 1 <= filterMoveColumnsOptions.length - 1)
            setActiveModalIndex((prev) => prev + 1);
        }
        if (e.keyCode === 38) {
          if (activeModalIndex - 1 >= 0)
            setActiveModalIndex((prev) => prev - 1);
        }
        //[Enter] pressed
        if (e.key === "Enter") {
          e.preventDefault();
          if (
            ["done"].includes(moveTaskModalInput.toLowerCase()) ||
            filterMoveColumnsOptions[activeModalIndex] === "Done"
          ) {
            setSceneState((prevState) => ({
              ...prevState,
              scene25: !prevState.scene25,
            }));
            updateScene(undefined, false, undefined);
            setBoard((prev) => {
              const updatedBoard = { ...prev };
              const sections = [...updatedBoard.sections];
              const firstSection = { ...sections[0] };
              const lastSection = { ...sections[2] };
              const firstSectionTasks = [...firstSection.tasks];
              const updatedFirstSectionTasks = [...firstSectionTasks.slice(1)];
              const updatedLastSectionTasks = [firstSectionTasks[0]];
              const updatedFirstSection = {
                ...firstSection,
                tasks: updatedFirstSectionTasks,
              };
              const updatedLastSection = {
                ...lastSection,
                tasks: updatedLastSectionTasks,
              };
              const updatedSections = [
                updatedFirstSection,
                sections[1],
                updatedLastSection,
              ];
              const newBoard = { ...updatedBoard, sections: updatedSections };
              return newBoard;
            });
          } else {
            errorShake();
          }
        }
      },
      scene26: (e: KeyboardEvent) => {
        e.preventDefault();
        //[shift] pressed
        if (
          e.key === "Shift" &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene26: {
              ...prevState.scene26,
              shiftPressed: prevState.scene26.shiftPressed + 1,
            },
          }));
          updateHint();
        }
        //[l] pressed
        else if (e.shiftKey && controller[76]?.pressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene26: {
              lPressed: !prevState.scene26.lPressed,
              shiftPressed: true,
            },
          }));
          setBoard((prev) => {
            const updatedBoard = { ...prev };
            const taskToMove = {
              ...updatedBoard.sections[activeColumn].tasks[activeTask],
            };
            const newSections = updatedBoard.sections.map((section, index) => {
              if (index === activeColumn) {
                return {
                  ...section,
                  tasks: section.tasks.filter(
                    (task, index) => index !== activeTask
                  ),
                };
              } else if (index === activeColumn + 1) {
                return { ...section, tasks: [taskToMove, ...section.tasks] };
              }
              return section;
            });

            return { ...updatedBoard, sections: newSections };
          });
          setActiveColumn((prev) => prev + 1);
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene27: (e: KeyboardEvent) => {
        e.preventDefault();
        //[shift] pressed
        if (
          e.key === "Shift" &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene27: {
              ...prevState.scene27,
              shiftPressed: true,
            },
          }));
          updateHint();
        }
        //[j] pressed
        else if (e.shiftKey && controller[74]?.pressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene27: {
              jPressed: !prevState.scene27.jPressed,
              shiftPressed: true,
            },
          }));

          setBoard((prev) => {
            const updatedBoard = { ...prev };
            const sections = [...updatedBoard.sections];
            const currentSection = { ...sections[activeColumn] };
            const updatedCurrentTasks = [
              currentSection.tasks[1],
              currentSection.tasks[0],
              ...currentSection.tasks.slice(2),
            ];
            const updatedCurrentSection = {
              ...currentSection,
              tasks: updatedCurrentTasks,
            };
            const updatedSections = [
              ...sections.slice(0, activeColumn),
              updatedCurrentSection,
              ...sections.slice(activeColumn + 1),
            ];

            const newBoard = { ...updatedBoard, sections: updatedSections };
            return newBoard;
          });
          updateScene(undefined, false, undefined);
          setActiveTask((prev) => prev + 1);
        } else {
          errorShake();
        }
      },
      scene28: (e: KeyboardEvent) => {
        e.preventDefault();
        //[Enter] pressed
        if (e.key === "Enter") {
          setSceneState((prevState) => ({
            ...prevState,
            scene28: !prevState.scene28,
          }));
          updateScene("taskDetail", true, undefined);
        } else {
          errorShake();
        }
      },
      scene29: (e: KeyboardEvent) => {
        e.preventDefault();
        //[ctrl] pressed
        if (
          e.key === "Control" &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          setSceneState((prevState) => ({
            ...prevState,
            scene29: {
              ...prevState.scene29,
              ctrlPressed: true,
            },
          }));
          updateHint();
        }
        //[d] pressed
        else if (controller[68]?.pressed && e.ctrlKey) {
          setSceneState((prevState) => ({
            ...prevState,
            scene29: {
              dPressed: !prevState.scene29.dPressed,
              ctrlPressed: true,
            },
          }));

          //focus on description somehow
          if (descriptionEditor) descriptionEditor.commands.focus("end");
          updateScene(undefined, false, undefined);
        } else {
          errorShake();
        }
      },
      scene30: (e: KeyboardEvent) => {
        var cmdControl = isApple ? "Meta" : "Control";
        var cmdControlKey = isApple ? e.metaKey : e.ctrlKey;
        var notCmdControl = isApple ? e.ctrlKey : e.metaKey;
        e.preventDefault();
        //[cmd/ctrl] pressed
        if (
          e.key === cmdControl &&
          cmdControlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !notCmdControl
        ) {
          e.preventDefault();
          setSceneState((prevState) => ({
            ...prevState,
            scene30: {
              ...prevState.scene30,
              ctrlPressed: true,
            },
          }));
          updateHint();
        }
        //[j] pressed
        else if (cmdControlKey && controller[74]?.pressed) {
          setSceneState((prevState) => ({
            ...prevState,
            scene30: {
              jPressed: !prevState.scene30.jPressed,
              ctrlPressed: true,
            },
          }));
          updateScene(undefined, false, undefined);
        } else if (cmdControlKey && !controller[74]?.pressed) {
          errorShake();
        }
      },
      scene31: (e: KeyboardEvent) => {},
      scene32: (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.key === "Escape") {
          updateScene("end", true, undefined);
        } else {
          errorShake();
        }
      },
      scene33: (e: KeyboardEvent) => {
        e.preventDefault();
        if (e.keyCode === 13) {
          exitTutorial();
        }
      },
    }),
    [
      updateScene,
      sceneState.scene2.jCount,
      sceneState.scene2.kCount,
      sceneState.scene3.tabCount,
      sceneState.scene13.jCount,
      sceneState.scene13.eCount,
      sceneState.scene13.kCount,
      updateHint,
      controller,
      pathname,
      commentEditor,
      isApple,
      commentInput,
      activeTaskPage,
      currentUser,
      filteredAssignees,
      activeModalIndex,
      filterPriorityOptions,
      activeNotification,
      filteredOptions,
      remindMeModalInput,
      filteredSideBarOptions,
      sideBarInput,
      addColumnInput,
      filterMoveColumnsOptions,
      moveTaskModalInput,
      activeColumn,
      activeTask,
      descriptionEditor,
      exitTutorial,
    ]
  );

  const handleKeyDown = useCallback(
    (e: any) => {
      if (controller[e.keyCode]) {
        controller[e.keyCode].pressed = true;
      }
      //exit statement
      var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
      if (
        isLoggedIn &&
        cmdControl &&
        controller[190]?.pressed &&
        currentUser.UserSetting.onboardingTutorialStatus
      ) {
        controller[190].pressed = false;
        return exitTutorial();
      }
      if (keyDownSceneHandlers[`scene${activeScene.index}`]) {
        keyDownSceneHandlers[`scene${activeScene.index}`](e);
      }
    },
    [
      controller,
      isApple,
      isLoggedIn,
      currentUser,
      keyDownSceneHandlers,
      activeScene.index,
      exitTutorial,
    ]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (keyUpSceneHandlers[`scene${activeScene.index}`]) {
        keyUpSceneHandlers[`scene${activeScene.index}`](e);
      }
      if (controller[e.keyCode]) {
        controller[e.keyCode].pressed = false;
      }
    },
    [activeScene, keyUpSceneHandlers, controller]
  );

  //these useeffects need to be changed. Its absurd that I did this.
  useEffect(() => {
    const filtered = sidebarInfo.filter((option) =>
      option.title.toLowerCase().includes(sideBarInput.toLowerCase())
    );
    setActiveModalIndex(0);
    setFilteredSideBarOptions(filtered);
  }, [sideBarInput]);

  useEffect(() => {
    const filtered = defaultOptions.filter((option) =>
      option.display.toLowerCase().includes(remindMeModalInput.toLowerCase())
    );
    setActiveModalIndex(0);

    setFilteredOptions(filtered);
  }, [remindMeModalInput]);

  useEffect(() => {
    const filtered = moveColumns.filter((option) =>
      option.toLowerCase().includes(moveTaskModalInput.toLocaleLowerCase())
    );
    setActiveModalIndex(0);
    setFilterMoveOptions(filtered);
  }, [moveTaskModalInput]);

  useEffect(() => {
    const filtered = priorities.filter((option) =>
      option.title
        .toLowerCase()
        .includes(priorityModalInput.toLocaleLowerCase())
    );
    setActiveModalIndex(0);
    setFilterPriorityOptions(filtered);
  }, [priorityModalInput]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  const getURLString = useCallback(async () => {
    const shareId = params?.get("shareId");
    const toSkip = params?.get("launch");

    if (toSkip && toSkip === "true") {
      setShowExit(true);
    }

    // Launched from the onboarding sequence: return there to finish it (Launch step)
    // instead of dumping the user on "/" (which the middleware bounces to /onboarding step 0).
    const onboardingReturn = parseCookies()?.onboarding_return;
    if (onboardingReturn) {
      return onboardingReturn;
    }

    if (!shareId || shareId === "null") {
      return "/";
    }

    try {
      const res = await axios.post(`${getSharedTaskRoute}?shareId=${shareId}`);

      if (res.status === 200) {
        return `/detail/project-${res.data.taskShared.projectId}/${res.data.taskShared.task.uniqueIndex}`;
      }

      return "/";
    } catch (error) {
      console.error("Error fetching shared task:", error);
      return "/";
    }
  }, [params]);

  const onMountOperation = useCallback(async () => {
    // If not logged in and not a funnel user, redirect home
    if (!isLoggedIn && !isFunnelUser) {
      router.push("/");
      return;
    }

    // Funnel user flow
    if (!isLoggedIn && isFunnelUser) {
      setShowExit(true);
      return;
    }

    // Logged in user flow
    if (isLoggedIn) {
      // If already on tutorial page, just set up the state and don't redirect
      if (pathname?.startsWith("/interactive-onboarding")) {
        resetActiveScene();
        setShowExit(!!currentUser.UserSetting.onboardingTutorialStatus);
        const exit = await getURLString();
        setExitURL(exit);
        return; // Don't redirect if already on tutorial page
      }

      resetActiveScene();
      setShowExit(!!currentUser.UserSetting.onboardingTutorialStatus);
      const exit = await getURLString();
      setExitURL(exit);
      router.replace("/interactive-onboarding/landing?scene=0");
    }
  }, [
    isLoggedIn,
    isFunnelUser,
    funnelTutorialCompleted,
    resetActiveScene,
    getURLString,
    router,
    currentUser,
    pathname,
  ]);

  useEffect(() => {
    onMountOperation();
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (activeScene.index < 1) {
      intervalId = setInterval(() => errorShake(), 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeScene]);

  const skipTutorial = async () => {
    if (!isLoggedIn && isFunnelUser) {
      markTutorialCompleted();
      router.push("/login");
    } else {
      // For logged-in users, update tutorial status if not already updated
      if (isLoggedIn && !currentUser.UserSetting.onboardingTutorialStatus) {
        try {
          const newSetting: any = await updateUserSettingTutorial(
            currentUser.id,
            true
          );
          
          setCurrentUser((prev: any) => {
            const updatedUser = { ...prev, UserSetting: { ...newSetting } };
            nookies.set(
              null,
              "nookies_user",
              JSON.stringify(slimUserForCookie(updatedUser)),
              {
                maxAge: 600 * 60 * 24 * 7, // 1 week
                path: "/",
              },
            );
            return updatedUser;
          });

        } catch (error) {
          console.error('❌ Failed to update tutorial status:', error);
        }
      }
      exitTutorial();
    }
  };

  //This useEffect keeps track of progress.
  //If you want to add progress then TutorialActiveSceneAtom has a phase value that is updated everytime a certain scene is over.
  //Also you will  have to persist the TutorialActiveSceneAtom

  // useEffect(() => {
  //   if (document.readyState === "complete") {
  //     handlePageLoad();
  //   } else {
  //     window.addEventListener("load", handlePageLoad);
  //   }
  //   return () => {
  //     window.removeEventListener("load", handlePageLoad);
  //   };
  // }, [handlePageLoad]);

  return {
    activeBoard,
    activeScene,
    activeTask,
    activeColumn,
    sceneState,
    activeNotification,
    activeTaskPage,
    remindMeModalInput,
    handleRemindMeModalInput,
    filteredOptions,
    splitTitles,
    notifications,
    filteredSideBarOptions,
    handleSideBarInput,
    sideBarInput,
    activeModalIndex,
    addColumnInput,
    handleAddColumnInput,
    moveTaskModalInput,
    handleMoveTaskInput,
    board,
    commentInput,
    handleCommentInput,
    commentEditor,
    descriptionEditor,
    shake,
    activeHint,
    currentScene: scenes[activeScene.index],
    updateScene,
    filterMoveColumnsOptions,
    handleCommandCallback,
    AITaskWriterHandler,
    description,
    title,
    filterPriorityOptions,
    handlePriorityInput,
    priorityModalInput,
    exitTutorial,
    currentUser: displayUser,
    showExit,
    assigneeInput,
    filteredAssignees,
    handleAssigneeInput,
    skipTutorial,
    isFunnelUser: isFunnelUser && !isLoggedIn,
    isFunnelUserAndNotCompleted:
      isFunnelUser && !funnelTutorialCompleted && !currentUser,
  };
};
