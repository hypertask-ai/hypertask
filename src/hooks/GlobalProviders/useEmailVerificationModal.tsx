import { currentUserAtom } from "@/store";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { usePathname } from "next/navigation";
import { isGuestUser } from "@/lib/demo/guest";
import { STRAIGHT_BOARD_SIGNUP_COOKIE } from "@/lib/auth/emailStraightBoard";

const useEmailVerificationModal = () => {
    const [showEmailVerificationModal, setShowEmailVerificationModal] = useState(false);
    const [currentUser, ___] = useRecoilState(currentUserAtom)
    const pathname = usePathname()
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
      
      const straightBoardPending =
        typeof document !== "undefined" &&
        document.cookie.includes(`${STRAIGHT_BOARD_SIGNUP_COOKIE}=1`);

      if (!isVerified && !isExcludedPath && !straightBoardPending) {
        setShowEmailVerificationModal(true);
      } else {
        setShowEmailVerificationModal(false);
      }
    }
  }, [currentUser, pathname]);

  return {
    showEmailVerificationModal,
    setShowEmailVerificationModal,
  }
}

export default useEmailVerificationModal;
