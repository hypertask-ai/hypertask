import { createTutorialKeymap } from "./useTutorialEngine";
import { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import useTiptap from "@/components/RTE/Tiptap";
import { defaultOptions, getBoards, getSidebarInfo, moveColumns, multipleKeys, priorities, sceneStates, staticNotifications, staticSplitTitles, tutorialUsers } from "@/lib/constants/InteractiveOnboarding/constants";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { IBoard, IBoardHeader, INotification, ISplitTitle, TTutorialPage } from "@/models/InteractiveOnboarding/model";
import { currentUserAtom, tutorialActiveSceneAtom } from "@/store";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRecoilState, useResetRecoilState } from "@/lib/state";
import { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { useScene } from "./useScenes";
import { updateUserSettingTutorial } from "@/lib/serverActions";
import nookies, { parseCookies } from "nookies";
import axios from "axios";
import { getSharedTaskRoute } from "@/lib/constants/APIRouteConstants";
import { IUser } from "@/models/model";
import useFunnelCookies from "../MultiPages/useFunnelCookies";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
type TSceneHandler = {
    [key in string]: (e: KeyboardEvent) => void;
};
export const useTutorial = () => {
    const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
    // Provide a dummy user for display purposes only
    const displayUser: IUser = currentUser ?? {
        id: 0,
        displayName: "You",
        email: "you-demo@hypertask.ai",
        photoURL: "https://ui-avatars.com/api/?name=John+Doe&background=0066cc&color=fff&size=150",
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
    const [board, setBoard] = useState<IBoard>(getBoards(displayUser)[activeBoard]);
    const [assigneeInput, setAssigneeInput] = useState<string>("");
    const [filteredAssignees, setFilteredAssignees] = useState(tutorialUsers);
    const [commentInput, setCommentInput] = useState<string>("");
    const [filteredOptions, setFilteredOptions] = useState<(DisplayDate | undefined)[]>(defaultOptions);
    const [filterMoveColumnsOptions, setFilterMoveOptions] = useState<string[]>(moveColumns);
    const [filterPriorityOptions, setFilterPriorityOptions] = useState<any[]>(priorities);
    const [filteredSideBarOptions, setFilteredSideBarOptions] = useState<IBoardHeader[]>(sidebarInfo);
    const [moveTaskModalInput, setMoveTaskModalInput] = useState("");
    const [priorityModalInput, setPriorityInput] = useState("");
    const [notifications, setNotifications] = useState<INotification[]>(staticNotifications);
    const [remindMeModalInput, setRemindMeModalInput] = useState("");
    const resetActiveScene = useResetRecoilState(tutorialActiveSceneAtom);
    const [sceneState, setSceneState] = useState<{
        [key in string]: any;
    }>(sceneStates);
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
    const { isFunnelUser, isLoggedIn, isFunnelUserAndTutorialCompleted: funnelTutorialCompleted, markTutorialCompleted, } = useFunnelCookies();
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
            const newSetting: any = await updateUserSettingTutorial(currentUser.id, true);
            setCurrentUser((prev: any) => {
                const updatedUser = { ...prev, UserSetting: { ...newSetting } };
                nookies.set(null, "nookies_user", JSON.stringify(slimUserForCookie(updatedUser)), {
                    maxAge: 600 * 60 * 24 * 7, // 1 week
                    path: "/",
                });
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
    const controller: {
        [key: number]: {
            pressed: boolean;
        };
    } = useMemo(() => {
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
        const filtered = tutorialUsers.filter((option) => option.name.toLowerCase().includes(e.target.value.toLowerCase()));
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
    const AITaskWriterHandler = (s: string, proceed?: boolean, newTitle?: string) => {
        if (descriptionEditor)
            descriptionEditor.commands.setContent(s);
        setDescription(s);
        if (proceed)
            updateScene(undefined, false, undefined);
        if (newTitle)
            setTitle(newTitle);
    };
    //------------------------------------------------SCENE UPDATERS
    const updateHint = useCallback((increment: number = 1) => {
        setShake(false);
        setActiveHint((prev) => (prev + increment <= 0 ? 0 : prev + increment));
    }, [shake, activeHint]);
    const updateScene = useCallback((page: TTutorialPage, push: boolean, phase: number | undefined) => {
        setShake(false);
        setActiveHint(0);
        let url = `/interactive-onboarding/${page ?? activeScene.currPage}?scene=${activeScene.index + 1}`;
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
    }, [activeScene, activeHint, shake]);
    //------------------------------------------------KEY HANDLERS
    const keyUpSceneHandlers: TSceneHandler = useMemo(() => ({
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
            }
            else if (e.keyCode === 17 && sceneState.scene5.mPressed) {
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
            }
            else if (e.keyCode === 16 && sceneState.scene26.lPressed) {
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
            }
            else if (e.keyCode === 17 && sceneState.scene29.dPressed) {
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
    }), [sceneState, pathname, activeHint, activeScene, controller]);
    const keyDownSceneHandlers: TSceneHandler = useMemo(() => createTutorialKeymap({ activeColumn, activeModalIndex, activeNotification, activeTask, activeTaskPage, addColumnInput, commentEditor, commentInput, controller, descriptionEditor, displayUser, errorShake, exitTutorial, filterMoveColumnsOptions, filterPriorityOptions, filteredAssignees, filteredOptions, filteredSideBarOptions, isApple, isInputValid, lastGPress, moveTaskModalInput, pathname, remindMeModalInput, sceneState, setActiveBoard, setActiveColumn, setActiveHint, setActiveModalIndex, setActiveNotification, setActiveTask, setActiveTaskPage, setBoard, setNotifications, setSceneState, setShake, sideBarInput, updateHint, updateScene }), [
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
    ]);
    const handleKeyDown = useCallback((e: any) => {
        if (controller[e.keyCode]) {
            controller[e.keyCode].pressed = true;
        }
        //exit statement
        var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
        if (isLoggedIn &&
            cmdControl &&
            controller[190]?.pressed &&
            currentUser.UserSetting.onboardingTutorialStatus) {
            controller[190].pressed = false;
            return exitTutorial();
        }
        if (keyDownSceneHandlers[`scene${activeScene.index}`]) {
            keyDownSceneHandlers[`scene${activeScene.index}`](e);
        }
    }, [
        controller,
        isApple,
        isLoggedIn,
        currentUser,
        keyDownSceneHandlers,
        activeScene.index,
        exitTutorial,
    ]);
    const handleKeyUp = useCallback((e: KeyboardEvent) => {
        if (keyUpSceneHandlers[`scene${activeScene.index}`]) {
            keyUpSceneHandlers[`scene${activeScene.index}`](e);
        }
        if (controller[e.keyCode]) {
            controller[e.keyCode].pressed = false;
        }
    }, [activeScene, keyUpSceneHandlers, controller]);
    //these useeffects need to be changed. Its absurd that I did this.
    useEffect(() => {
        const filtered = sidebarInfo.filter((option) => option.title.toLowerCase().includes(sideBarInput.toLowerCase()));
        setActiveModalIndex(0);
        setFilteredSideBarOptions(filtered);
    }, [sideBarInput]);
    useEffect(() => {
        const filtered = defaultOptions.filter((option) => option.display.toLowerCase().includes(remindMeModalInput.toLowerCase()));
        setActiveModalIndex(0);
        setFilteredOptions(filtered);
    }, [remindMeModalInput]);
    useEffect(() => {
        const filtered = moveColumns.filter((option) => option.toLowerCase().includes(moveTaskModalInput.toLocaleLowerCase()));
        setActiveModalIndex(0);
        setFilterMoveOptions(filtered);
    }, [moveTaskModalInput]);
    useEffect(() => {
        const filtered = priorities.filter((option) => option.title
            .toLowerCase()
            .includes(priorityModalInput.toLocaleLowerCase()));
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
        }
        catch (error) {
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
            if (intervalId)
                clearInterval(intervalId);
        };
    }, [activeScene]);
    const skipTutorial = async () => {
        if (!isLoggedIn && isFunnelUser) {
            markTutorialCompleted();
            router.push("/login");
        }
        else {
            // For logged-in users, update tutorial status if not already updated
            if (isLoggedIn && !currentUser.UserSetting.onboardingTutorialStatus) {
                try {
                    const newSetting: any = await updateUserSettingTutorial(currentUser.id, true);
                    setCurrentUser((prev: any) => {
                        const updatedUser = { ...prev, UserSetting: { ...newSetting } };
                        nookies.set(null, "nookies_user", JSON.stringify(slimUserForCookie(updatedUser)), {
                            maxAge: 600 * 60 * 24 * 7, // 1 week
                            path: "/",
                        });
                        return updatedUser;
                    });
                }
                catch (error) {
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
        isFunnelUserAndNotCompleted: isFunnelUser && !funnelTutorialCompleted && !currentUser,
    };
};
