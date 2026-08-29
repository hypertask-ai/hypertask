import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import { IUser } from "@/models/model";
import {
  ArchivedTaskIndexAtom,
  globalNotificationFocusAtom,
  InboxTaskIndexAtom,
  SearchTaskIndexAtom,
  showTrialModalAtom,
} from "@/store";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";

const useGlobalPathCheck = (currentUser: IUser | null) => {
  const [allowShowSettings, setAllowShowSettings] = useState(false);
  const [showTrialModal, setShowTrialModal] = useRecoilState(showTrialModalAtom);
  const [_, setGlobalFocus] = useRecoilState(globalNotificationFocusAtom);
  const [__, setInboxTaskIndexAtom] = useRecoilState(InboxTaskIndexAtom);
  const [___, setSearchTaskIndexAtom] = useRecoilState(SearchTaskIndexAtom);
  const [____, setArchivedTaskIndexAtom] = useRecoilState(
    ArchivedTaskIndexAtom
  );
  const { closeAIChatInterface } = useGlobalUIState();

  const pathname = usePathname();
  useEffect(() => {
    const excludedPaths = [
      "/login",
      "/unauthorized",
      "/pricing",
      "/onboarding",
      "/trial-plan-confirmation",
      "/interactive-onboarding",
      "/learn",
      "/invite",
      "/share",
      "/oauth",
      "/settings"
    ];

    const isExcludedPath = excludedPaths.some(
      (path) => pathname === path || pathname?.startsWith(path)
    );

    // Handle settings visibility
    setAllowShowSettings(!isExcludedPath);

    // Reset index items when not in inbox, drafts or detail pages
    if (
      !pathname?.startsWith("/inbox") &&
      !pathname?.startsWith("/detail") &&
      !pathname?.startsWith("/drafts")
    ) {
      setGlobalFocus({ currIdx: 0, currSplit: 0 });
    }

    // Reset specific page indexes
    if (!pathname?.startsWith("/inbox")) setInboxTaskIndexAtom(0);
    if (!pathname?.startsWith("/search")) setSearchTaskIndexAtom(0);
    if (!pathname?.startsWith("/archive")) setArchivedTaskIndexAtom(0);
    const checkForAIChat =
      pathname?.startsWith("/login") ||
      pathname?.startsWith("/share") ||
      pathname?.startsWith("/interactive-onboarding") ||
      pathname?.startsWith("/learn") ||
      pathname?.startsWith("/full-plan-confirmation") ||
      pathname?.startsWith("/integrations") ||
      pathname?.startsWith("/pricing") ||
      pathname?.startsWith("/unauthorized") ||
      pathname?.startsWith("/trial") ||
      pathname?.startsWith("/cli-auth");
    if (checkForAIChat) closeAIChatInterface();

    // HTPR-4839: out-of-trial users stay on the free tier; nothing compels a
    // redirect to /trial any more (the page stays reachable voluntarily).
  }, [pathname, currentUser, currentUser?.UserSetting?.trialStatus]);

  return {
    allowShowSettings,
    setAllowShowSettings,
    showTrialModal,
    setShowTrialModal,
  };
};

export default useGlobalPathCheck;
