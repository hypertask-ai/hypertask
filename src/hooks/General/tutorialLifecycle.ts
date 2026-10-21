import {
  defaultOptions,
  moveColumns,
  priorities,
} from "@/lib/constants/InteractiveOnboarding/constants";
import { useEffect, useCallback } from "react";
import { updateUserSettingTutorial } from "@/lib/serverActions";
import nookies, { parseCookies } from "nookies";
import axios from "axios";
import { getSharedTaskRoute } from "@/lib/constants/APIRouteConstants";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import type { TutorialContext } from "./tutorialActions";
import type { useTutorialKeyboard } from "./tutorialKeyboard";
import { useTutorialEngine } from "./useTutorialEngine";

export const useTutorialLifecycle = (context: TutorialContext & ReturnType<typeof useTutorialKeyboard>) => {
  const {
    currentUser,
    setCurrentUser,
    sidebarInfo,
    setShowExit,
    setActiveModalIndex,
    activeScene,
    setExitURL,
    setFilteredOptions,
    setFilterMoveOptions,
    setFilterPriorityOptions,
    setFilteredSideBarOptions,
    moveTaskModalInput,
    priorityModalInput,
    remindMeModalInput,
    resetActiveScene,
    sideBarInput,
    title,
    params,
    pathname,
    router,
    isFunnelUser,
    isLoggedIn,
    funnelTutorialCompleted,
    markTutorialCompleted,
    exitTutorial,
    errorShake,
    handleKeyDown,
    handleKeyUp,
  } = context;

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

  useTutorialEngine(() => ({
    target: document,
    handleKeyDown,
    handleKeyUp,
  }), [handleKeyDown, handleKeyUp]);

  const getURLString = useCallback(async () => {
    const shareId = params?.get("shareId");
    const toSkip = params?.get("launch");

    if (toSkip && toSkip === "true") {
      setShowExit(true);
    }

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
    if (!isLoggedIn && !isFunnelUser) {
      router.push("/");
      return;
    }

    if (!isLoggedIn && isFunnelUser) {
      setShowExit(true);
      return;
    }

    if (isLoggedIn) {
      if (pathname?.startsWith("/interactive-onboarding")) {
        resetActiveScene();
        setShowExit(!!currentUser.UserSetting.onboardingTutorialStatus);
        const exit = await getURLString();
        setExitURL(exit);
        return;
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
                maxAge: 600 * 60 * 24 * 7,
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
  return { skipTutorial };
};
