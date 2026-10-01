import { useCallback, useMemo } from "react";
import type { TutorialContext } from "./tutorialActions";
import {
  createTutorialBoardSteps,
  createTutorialTaskSteps,
  createTutorialNavigationSteps,
  createTutorialWorkflowSteps,
} from "./tutorialSteps";

type TSceneHandler = { [key in string]: (e: KeyboardEvent) => void };

export const useTutorialKeyboard = (context: TutorialContext) => {
  const {
    currentUser,
    activeColumn,
    activeHint,
    setActiveHint,
    activeModalIndex,
    activeNotification,
    activeScene,
    activeTask,
    activeTaskPage,
    addColumnInput,
    filteredAssignees,
    commentInput,
    filteredOptions,
    filterMoveColumnsOptions,
    filterPriorityOptions,
    filteredSideBarOptions,
    moveTaskModalInput,
    remindMeModalInput,
    sceneState,
    setSceneState,
    sideBarInput,
    lastGPress,
    commentEditor,
    descriptionEditor,
    isApple,
    pathname,
    isLoggedIn,
    exitTutorial,
    controller,
    updateHint,
    updateScene,
  } = context;

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
      ...createTutorialBoardSteps(context),
      ...createTutorialTaskSteps(context),
      ...createTutorialNavigationSteps(context),
      ...createTutorialWorkflowSteps(context),
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
  return { handleKeyDown, handleKeyUp };
};
