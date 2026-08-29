import { currentUserAtom } from "@/store";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { usePathname } from "next/navigation";
import { isGuestUser } from "@/lib/demo/guest";

const useEmailVerificationModal = () => {
    const [showEmailVerificationModal, setShowEmailVerificationModal] = useState(false);
    const [currentUser, ___] = useRecoilState(currentUserAtom)
    const pathname = usePathname()
  useEffect(() => {
    // Check if user needs email verification
    // HTPR-4303: anonymous demo guests have a throwaway email and no trial to
    // activate — the verify-email wall must never block their board.
    if (currentUser && isGuestUser(currentUser)) {
      setShowEmailVerificationModal(false);
      return;
    }
    if (currentUser && currentUser.UserSetting) {
      const isVerified = currentUser.UserSetting.isVerified ?? true; // Default to true for backward compatibility
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
      
      // Show verification modal if user is not verified and not on excluded paths
      if (!isVerified && !isExcludedPath ) {
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
