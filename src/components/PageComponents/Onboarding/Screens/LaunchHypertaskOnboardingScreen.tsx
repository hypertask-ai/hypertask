"use client";
import { useContext } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import axios from "axios";
import { getSharedTaskRoute } from "@/lib/constants/APIRouteConstants";
import { useCompleteOnboarding } from "../useCompleteOnboarding";
import { GetStartedButton } from "../GetStartedButton";

export const LaunchHypertaskOnboardingScreen = () => {
  const params = useSearchParams();
  const router = useRouter();
  const isMbl = useContext(MobileViewContext);
  const { completeOnboarding, currentUser } = useCompleteOnboarding();

  const constructRouteURL = async () => {
    const projectId = params?.get("projectId");
    const shareId = params?.get("shareId");

    router.refresh();
    //New funnel doesn't require users to go through interactive tutorial
    if (!isMbl) {
      if (projectId && projectId.length > 0 && projectId !== "undefined") {
        return `/project?id=${projectId}`;
      } else return `/`;
    } else {
      if (currentUser.UserSetting.trialStatus) {
        if (shareId && shareId.length > 0 && shareId !== "undefined") {
          return await getSharedTaskInfoURL(shareId);
        }
      }
      return `/project?id=${projectId}`;
    }
  };

  const getSharedTaskInfoURL = async (shareId: string) => {
    const res = await axios.post(`${getSharedTaskRoute}?shareId=${shareId}`);
    if (res.status === 200) {
      return `/detail/project-${res.data.taskShared.projectId}/${res.data.taskShared.task.uniqueIndex}`;
    }
    return "/";
  };

  const addWelcomeAiParam = (route: string) => {
    const [pathname, search = ""] = route.split("?");
    const searchParams = new URLSearchParams(search);
    searchParams.set("welcome_ai", "1");
    return `${pathname}?${searchParams.toString()}`;
  };

  const launchHypertask = async () => {
    const completed = await completeOnboarding();
    if (!completed) return;

    const routeToVisit = await constructRouteURL();
    router.push(addWelcomeAiParam(routeToVisit));
  };

  return (
    <div className="flex flex-col gap-6 items-center justify-center max-w-[600px] mx-auto px-4 cursor-default text-center">
      <div className="space-y-3">
        <h2 className="text-heading sm:text-display font-semibold text-white-black">
          You&apos;re all set.
        </h2>
        <p className="text-text-light-gray text-emphasis">
          Your workspace is ready.
        </p>
      </div>

      <GetStartedButton onClick={launchHypertask} text="Launch Hypertask" />
    </div>
  );
};
