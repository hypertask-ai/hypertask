import {
  multipleKeys,
  tutorialUsers,
} from "@/lib/constants/InteractiveOnboarding/constants";
import { TTutorialPage } from "@/models/InteractiveOnboarding/model";
import { useCallback, useMemo } from "react";
import { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { updateUserSettingTutorial } from "@/lib/serverActions";
import nookies from "nookies";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import type { TutorialState } from "./tutorialState";

export const useTutorialActions = (context: TutorialState) => {
  const {
    currentUser,
    setCurrentUser,
    activeHint,
    setActiveHint,
    setActiveModalIndex,
    activeScene,
    setActiveScene,
    setAddColumnInput,
    exitURL,
    setAssigneeInput,
    setFilteredAssignees,
    setCommentInput,
    setMoveTaskModalInput,
    setPriorityInput,
    setRemindMeModalInput,
    shake,
    setShake,
    setSideBarInput,
    setDescription,
    setTitle,
    descriptionEditor,
    router,
    isFunnelUser,
    isLoggedIn,
    markTutorialCompleted,
  } = context;

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
      let url = `/interactive-onboarding/${page ?? activeScene.currPage
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
  return {
    exitTutorial,
    controller,
    errorShake,
    isInputValid,
    handleCommentInput,
    handleMoveTaskInput,
    handlePriorityInput,
    handleAddColumnInput,
    handleSideBarInput,
    handleAssigneeInput,
    handleRemindMeModalInput,
    handleCommandCallback,
    AITaskWriterHandler,
    updateHint,
    updateScene,
  };
};

export type TutorialContext = TutorialState & ReturnType<typeof useTutorialActions>;
