import { getBoards, tutorialUsers } from "@/lib/constants/InteractiveOnboarding/constants";
import { PriorityConstants } from "@/lib/constants/constants";
import toast from "react-hot-toast";

type TutorialContext = Record<string, any>;
export function createTutorialKeymap(context: TutorialContext) {
 const { activeColumn, activeModalIndex, activeNotification, activeTask, activeTaskPage, addColumnInput, commentEditor, commentInput, controller, descriptionEditor, displayUser, errorShake, exitTutorial, filterMoveColumnsOptions, filterPriorityOptions, filteredAssignees, filteredOptions, filteredSideBarOptions, isApple, isInputValid, lastGPress, moveTaskModalInput, pathname, remindMeModalInput, sceneState, setActiveBoard, setActiveColumn, setActiveHint, setActiveModalIndex, setActiveNotification, setActiveTask, setActiveTaskPage, setBoard, setNotifications, setSceneState, setShake, sideBarInput, updateHint, updateScene } = context;
 return ({
        scene0: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Enter] pressed
            if (e.key === "Enter") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene0: !prevState.scene0,
                }));
                updateScene(undefined, false, 0);
            }
            else {
                errorShake();
            }
        },
        scene1: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Enter] pressed
            if (e.key === "Enter") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene1: !prevState.scene1,
                }));
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene2: (e: KeyboardEvent) => {
            e.preventDefault();
            //[j] pressed
            if (e.keyCode === 74 &&
                sceneState.scene2.jCount < 3 &&
                sceneState.scene2.kCount === 0) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene2: {
                        ...prevState.scene2,
                        jCount: prevState.scene2.jCount + 1,
                    },
                }));
                setActiveTask((prev: any) => prev + 1);
                updateHint();
            }
            //[k] pressed
            else if (e.keyCode === 75 &&
                sceneState.scene2.jCount === 3 &&
                sceneState.scene2.kCount < 2) {
                setActiveTask((prev: any) => prev - 1);
                updateHint();
                if (sceneState.scene2.kCount === 1)
                    updateScene(undefined, false, undefined);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene2: {
                        ...prevState.scene2,
                        kCount: prevState.scene2.kCount + 1,
                    },
                }));
            }
            else {
                errorShake();
            }
        },
        scene3: (e: KeyboardEvent) => {
            e.preventDefault();
            //[tab] pressed
            if (controller[9]?.pressed &&
                !e.shiftKey &&
                sceneState.scene3.tabCount < 2) {
                setActiveColumn((prev: any) => prev + 1);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene3: {
                        ...prevState.scene3,
                        tabCount: prevState.scene3.tabCount + 1,
                    },
                }));
                updateHint();
            }
            //[shift] pressed
            else if (sceneState.scene3.tabCount === 2 &&
                e.key === "Shift" &&
                e.shiftKey &&
                !e.ctrlKey &&
                !e.altKey &&
                !e.metaKey) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene3: {
                        ...prevState.scene3,
                        shiftPressed: true,
                    },
                }));
                updateHint();
                //[shift]+[tab]
            }
            else if (e.shiftKey &&
                controller[9]?.pressed &&
                sceneState.scene3.tabCount === 2) {
                setActiveColumn((prev: any) => prev - 1);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene3: {
                        ...prevState.scene3,
                        tabCount: prevState.scene3.tabCount + 1,
                    },
                }));
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene4: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Enter] pressed
            if (e.key === "Enter") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene4: !prevState.scene4,
                }));
                updateScene("taskDetail", true, 1);
            }
            else {
                errorShake();
            }
        },
        scene5: (e: KeyboardEvent) => {
            e.preventDefault();
            if (!pathname?.startsWith("/interactive-onboarding/taskDetail"))
                return;
            //[ctrl] pressed
            if (e.key === "Control" &&
                e.ctrlKey &&
                !e.shiftKey &&
                !e.altKey &&
                !e.metaKey) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene5: {
                        mPressed: !prevState.scene5.mPressed,
                        ctrlPressed: true,
                    },
                }));
                if (commentEditor)
                    commentEditor.commands.focus("end");
                updateScene(undefined, false, undefined);
            }
            else {
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
            if (e.key === cmdControl &&
                cmdControlKey &&
                !e.shiftKey &&
                !e.altKey &&
                !notCmdControl) {
                e.preventDefault();
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene6: {
                        enterPressed: !prevState.scene6.enterPressed,
                        ctrlPressed: true,
                    },
                }));
                setBoard((prev: any) => {
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
            }
            else if (cmdControlKey && !controller[13]?.pressed) {
                errorShake();
            }
        },
        scene7: (e: KeyboardEvent) => {
            e.preventDefault();
            //[a] pressed
            if (e.keyCode === 65) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene7: !prevState.scene7,
                }));
                setActiveModalIndex(0);
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene8: (e: KeyboardEvent) => {
            if (e.keyCode === 40) {
                e.preventDefault();
                if (activeModalIndex + 1 <= filteredAssignees.length - 1)
                    setActiveModalIndex((prev: any) => prev + 1);
            }
            if (e.keyCode === 38) {
                e.preventDefault();
                if (activeModalIndex - 1 >= 0)
                    setActiveModalIndex((prev: any) => prev - 1);
            }
            //[Enter] pressed
            if (e.key === "Enter" &&
                filteredAssignees[activeModalIndex].name === tutorialUsers[1].name) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene8: !prevState.scene8,
                }));
                //update assignees if any.
                setBoard((prev: any) => {
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
            }
            else if (e.key === "Enter" &&
                filteredAssignees[activeModalIndex].name !== tutorialUsers[1].name) {
                errorShake();
            }
        },
        scene9: (e: KeyboardEvent) => {
            e.preventDefault();
            //[p] pressed
            if (e.keyCode === 80) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene9: !prevState.scene9,
                }));
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene10: (e: KeyboardEvent) => {
            //[downArrow] pressed
            if (e.keyCode === 40) {
                if (activeModalIndex + 1 <= 4)
                    setActiveModalIndex((prev: any) => prev + 1);
            }
            if (e.keyCode === 38) {
                if (activeModalIndex - 1 >= 0)
                    setActiveModalIndex((prev: any) => prev - 1);
            }
            //[Enter] pressed
            if (e.key === "Enter" &&
                filterPriorityOptions[activeModalIndex].index === 1) {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene10: !prevState.scene10,
                }));
                setBoard((prev: any) => {
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
            }
            else if (e.key === "Enter" &&
                filterPriorityOptions[activeModalIndex].index !== 1) {
                errorShake();
            }
        },
        scene11: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Esc] pressed
            if (e.key === "Escape") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene11: !prevState.scene11,
                }));
                updateScene("landing", true, 2);
            }
            else {
                errorShake();
            }
        },
        scene12: (e: KeyboardEvent) => {
            if (!pathname?.startsWith("/interactive-onboarding/landing"))
                return;
            e.preventDefault();
            //[g] pressed
            if (e.keyCode === 71 && !lastGPress.current) {
                const now = new Date().getTime();
                lastGPress.current = now;
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene12: {
                        ...prevState.scene12,
                        gPressed: true,
                    },
                }));
                updateHint();
                setTimeout(() => {
                    lastGPress.current = null;
                    setSceneState((prevState: any) => ({
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
                    setSceneState((prevState: any) => ({
                        ...prevState,
                        scene12: {
                            ...prevState.scene12,
                            iPressed: true,
                        },
                    }));
                    setActiveTaskPage((prev: any) => prev + 1);
                    updateScene("inbox", true, undefined);
                }
            }
            else {
                errorShake();
            }
        },
        scene13: (e: KeyboardEvent) => {
            if (!pathname?.startsWith("/interactive-onboarding/inbox"))
                return;
            e.preventDefault();
            //[j] pressed
            if (e.keyCode === 74 &&
                sceneState.scene13.jCount < 2 &&
                sceneState.scene13.eCount === 0 &&
                sceneState.scene13.kCount === 0) {
                setActiveNotification((prev: any) => prev + 1);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene13: {
                        ...prevState.scene13,
                        jCount: prevState.scene13.jCount + 1,
                    },
                }));
                updateHint();
            }
            //[k] pressed
            else if (e.keyCode === 75 &&
                sceneState.scene13.kCount < 2 &&
                sceneState.scene13.eCount === 0 &&
                sceneState.scene13.jCount === 2) {
                setActiveNotification((prev: any) => prev - 1);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene13: {
                        ...prevState.scene13,
                        kCount: prevState.scene13.kCount + 1,
                    },
                }));
                updateHint();
            }
            //[e] pressed
            else if (e.keyCode === 69 &&
                sceneState.scene13.jCount === 2 &&
                sceneState.scene13.kCount === 2 &&
                sceneState.scene13.eCount < 2) {
                updateHint();
                if (sceneState.scene13.eCount === 1)
                    updateScene(undefined, false, undefined);
                //setActiveNotification((prev: any) => prev - 1);
                setNotifications((prev: any) => {
                    //we need to remove the current active notification
                    const filtered = prev.filter((item: any, index: number) => index !== activeNotification);
                    return filtered;
                });
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene13: {
                        ...prevState.scene13,
                        eCount: prevState.scene13.eCount + 1,
                    },
                }));
            }
            else {
                errorShake();
            }
        },
        scene14: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Enter] pressed
            if (e.key === "Enter") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene14: !prevState.scene14,
                }));
                updateScene("taskDetail", true, undefined);
            }
            else {
                errorShake();
            }
        },
        scene15: (e: KeyboardEvent) => {
            if (!pathname?.startsWith("/interactive-onboarding/taskDetail"))
                return;
            e.preventDefault();
            //[e] pressed
            if (e.keyCode === 69) {
                updateScene(undefined, false, undefined);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene15: !prevState.scene15,
                }));
                setNotifications((prev: any) => prev.slice(0, -1) // Removes the last element
                );
                setActiveTaskPage((prev: any) => prev + 1);
                setTimeout(() => {
                    document
                        ?.getElementById("comment-input-interactive")
                        ?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                }, 100);
            }
            else {
                errorShake();
            }
        },
        scene16: (e: KeyboardEvent) => {
            e.preventDefault();
            //[h] pressed
            if (e.keyCode === 72) {
                updateScene(undefined, false, undefined);
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene16: !prevState.scene16,
                }));
                setActiveModalIndex(0);
            }
            else {
                errorShake();
            }
        },
        scene17: (e: KeyboardEvent) => {
            //[downArrow] pressed
            if (e.keyCode === 40) {
                if (activeModalIndex + 1 <= filteredOptions.length - 1)
                    setActiveModalIndex((prev: any) => prev + 1);
            }
            if (e.keyCode === 38) {
                if (activeModalIndex - 1 >= 0)
                    setActiveModalIndex((prev: any) => prev - 1);
            }
            //[Enter] pressed
            if (e.key === "Enter") {
                e.preventDefault();
                if (remindMeModalInput.includes("tomorrow") ||
                    filteredOptions[activeModalIndex]?.display === "tomorrow") {
                    setSceneState((prevState: any) => ({
                        ...prevState,
                        scene17: !prevState.scene17,
                    }));
                    setNotifications((prev: any) => prev.slice(0, -1) // Removes the last element
                    );
                    updateScene("inbox", true, undefined);
                }
                else {
                    errorShake();
                }
            }
        },
        scene18: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Esc] pressed
            if (e.key === "Escape") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene18: !prevState.scene18,
                }));
                updateScene("landing", true, 3);
            }
            else {
                errorShake();
            }
        },
        scene19: (e: KeyboardEvent) => {
            if (!pathname?.startsWith("/interactive-onboarding/landing"))
                return;
            e.preventDefault();
            var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
            var cmdControlKey = (isApple && "Meta") || (!isApple && "Control");
            if (e.key === cmdControlKey && !e.shiftKey && !e.altKey) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene19: {
                        bPressed: !prevState.scene19.bPressed,
                        cmdCtrlPressed: true,
                    },
                }));
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene20: (e: KeyboardEvent) => {
            //[downArrow] pressed
            if (e.keyCode === 40) {
                if (activeModalIndex + 1 <= filteredSideBarOptions.length - 1)
                    setActiveModalIndex((prev: any) => prev + 1);
            }
            if (e.keyCode === 38) {
                if (activeModalIndex - 1 >= 0)
                    setActiveModalIndex((prev: any) => prev - 1);
            }
            //[Enter] pressed
            if (e.key === "Enter") {
                e.preventDefault();
                if (sideBarInput.toLowerCase() === "product backlog" ||
                    filteredSideBarOptions[activeModalIndex].title === "Product Backlog") {
                    setSceneState((prevState: any) => ({
                        ...prevState,
                        scene20: !prevState.scene20,
                    }));
                    setActiveBoard((prev: any) => prev + 1);
                    setBoard(getBoards(displayUser)[1]);
                    setActiveColumn(0);
                    setActiveTask(0);
                    setActiveTaskPage(0);
                    updateScene(undefined, false, 4);
                }
                else {
                    errorShake();
                }
            }
        },
        scene21: (e: KeyboardEvent) => {
            e.preventDefault();
            var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
            var cmdControlKey = (isApple && "Meta") || (!isApple && "Control");
            if (e.key === cmdControlKey && !e.shiftKey && !e.altKey && cmdControl) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene21: {
                        kPressed: !prevState.scene21.bPressed,
                        cmdCtrlPressed: true,
                    },
                }));
                updateScene(undefined, false, undefined);
            }
            else {
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
            //     setSceneState((prevState: any) => ({
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
                    setSceneState((prevState: any) => ({
                        ...prevState,
                        scene23: !prevState.scene23,
                    }));
                    setBoard((prev: any) => {
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
                }
                else {
                    errorShake();
                }
            }
        },
        scene24: (e: KeyboardEvent) => {
            //[m] pressed
            if (e.keyCode === 77) {
                e.preventDefault();
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene24: !prevState.scene24,
                }));
                setActiveModalIndex(0);
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene25: (e: KeyboardEvent) => {
            //[downArrow] pressed
            if (e.keyCode === 40) {
                if (activeModalIndex + 1 <= filterMoveColumnsOptions.length - 1)
                    setActiveModalIndex((prev: any) => prev + 1);
            }
            if (e.keyCode === 38) {
                if (activeModalIndex - 1 >= 0)
                    setActiveModalIndex((prev: any) => prev - 1);
            }
            //[Enter] pressed
            if (e.key === "Enter") {
                e.preventDefault();
                if (["done"].includes(moveTaskModalInput.toLowerCase()) ||
                    filterMoveColumnsOptions[activeModalIndex] === "Done") {
                    setSceneState((prevState: any) => ({
                        ...prevState,
                        scene25: !prevState.scene25,
                    }));
                    updateScene(undefined, false, undefined);
                    setBoard((prev: any) => {
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
                }
                else {
                    errorShake();
                }
            }
        },
        scene26: (e: KeyboardEvent) => {
            e.preventDefault();
            //[shift] pressed
            if (e.key === "Shift" &&
                e.shiftKey &&
                !e.ctrlKey &&
                !e.altKey &&
                !e.metaKey) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene26: {
                        lPressed: !prevState.scene26.lPressed,
                        shiftPressed: true,
                    },
                }));
                setBoard((prev: any) => {
                    const updatedBoard = { ...prev };
                    const taskToMove = {
                        ...updatedBoard.sections[activeColumn].tasks[activeTask],
                    };
                    const newSections = updatedBoard.sections.map((section: any, index: number) => {
                        if (index === activeColumn) {
                            return {
                                ...section,
                                tasks: section.tasks.filter((task: any, index: number) => index !== activeTask),
                            };
                        }
                        else if (index === activeColumn + 1) {
                            return { ...section, tasks: [taskToMove, ...section.tasks] };
                        }
                        return section;
                    });
                    return { ...updatedBoard, sections: newSections };
                });
                setActiveColumn((prev: any) => prev + 1);
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene27: (e: KeyboardEvent) => {
            e.preventDefault();
            //[shift] pressed
            if (e.key === "Shift" &&
                e.shiftKey &&
                !e.ctrlKey &&
                !e.altKey &&
                !e.metaKey) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene27: {
                        jPressed: !prevState.scene27.jPressed,
                        shiftPressed: true,
                    },
                }));
                setBoard((prev: any) => {
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
                setActiveTask((prev: any) => prev + 1);
            }
            else {
                errorShake();
            }
        },
        scene28: (e: KeyboardEvent) => {
            e.preventDefault();
            //[Enter] pressed
            if (e.key === "Enter") {
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene28: !prevState.scene28,
                }));
                updateScene("taskDetail", true, undefined);
            }
            else {
                errorShake();
            }
        },
        scene29: (e: KeyboardEvent) => {
            e.preventDefault();
            //[ctrl] pressed
            if (e.key === "Control" &&
                e.ctrlKey &&
                !e.shiftKey &&
                !e.altKey &&
                !e.metaKey) {
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene29: {
                        dPressed: !prevState.scene29.dPressed,
                        ctrlPressed: true,
                    },
                }));
                //focus on description somehow
                if (descriptionEditor)
                    descriptionEditor.commands.focus("end");
                updateScene(undefined, false, undefined);
            }
            else {
                errorShake();
            }
        },
        scene30: (e: KeyboardEvent) => {
            var cmdControl = isApple ? "Meta" : "Control";
            var cmdControlKey = isApple ? e.metaKey : e.ctrlKey;
            var notCmdControl = isApple ? e.ctrlKey : e.metaKey;
            e.preventDefault();
            //[cmd/ctrl] pressed
            if (e.key === cmdControl &&
                cmdControlKey &&
                !e.shiftKey &&
                !e.altKey &&
                !notCmdControl) {
                e.preventDefault();
                setSceneState((prevState: any) => ({
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
                setSceneState((prevState: any) => ({
                    ...prevState,
                    scene30: {
                        jPressed: !prevState.scene30.jPressed,
                        ctrlPressed: true,
                    },
                }));
                updateScene(undefined, false, undefined);
            }
            else if (cmdControlKey && !controller[74]?.pressed) {
                errorShake();
            }
        },
        scene31: (e: KeyboardEvent) => { },
        scene32: (e: KeyboardEvent) => {
            e.preventDefault();
            if (e.key === "Escape") {
                updateScene("end", true, undefined);
            }
            else {
                errorShake();
            }
        },
        scene33: (e: KeyboardEvent) => {
            e.preventDefault();
            if (e.keyCode === 13) {
                exitTutorial();
            }
        },
    });
}
