import { currentUserAtom } from "@/store";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { usePathname } from "next/navigation";
import { isGuestUser } from "@/lib/demo/guest";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7553-email-straight-board";

const useEmailVerificationModal = () => {
    const [showEmailVerificationModal, setShowEmailVerificationModal] = useState(false);
    const [currentUser, ___] = useRecoilState(currentUserAtom)
    const pathname = usePathname()
    const straightBoardOn = useFlag(HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG)
  useEffect(() => {
    if (currentUser && isGuestUser(currentUser)) {
      setShowEmailVerificationModal(false);
      return;
    }
    if (currentUser && currentUser.UserSetting) {
      const isVerified = currentUser.UserSetting.isVerified ?? true;
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
        "/verify-email",
      ];
      const isExcludedPath = excludedPaths.some(
        (path) => pathname === path || pathname?.startsWith(path)
      );
      
      if (!isVerified && !isExcludedPath && !straightBoardOn) {
        setShowEmailVerificationModal(true);
      } else {
        setShowEmailVerificationModal(false);
      }
    }
  }, [currentUser, pathname, straightBoardOn]);

  return {
    showEmailVerificationModal,
    setShowEmailVerificationModal,
  }
}

export default useEmailVerificationModal;
