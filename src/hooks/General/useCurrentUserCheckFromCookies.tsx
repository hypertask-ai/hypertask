"use client"
import { currentUserAtom } from "@/store";
import { isValidUser } from "@/utils/edgeHelpers";
import { parseCookies } from "nookies";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { replaceEqualDeep } from "@tanstack/react-query";

const useCurrentUser = (authenticatedUserId?: number | null) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [_, setRecoilCurrentUser] = useRecoilState(currentUserAtom);
  const recoilUser = useRecoilValue(currentUserAtom);
  const lastSyncedRef = useRef<any>(null);
  
  // Read from cookies on mount
  useLayoutEffect(() => {
    // Only run this logic once on mount
    try {
      const cookies = parseCookies();
      const { isValid, user } = isValidUser(cookies?.nookies_user);
      
      if (
        isValid &&
        user &&
        (authenticatedUserId == null || user.id === authenticatedUserId)
      ) {
        setCurrentUser((current: any) => replaceEqualDeep(current, user));
        setRecoilCurrentUser((current: any) => replaceEqualDeep(current, user));
        lastSyncedRef.current = user;
      } else if (authenticatedUserId != null) {
        setCurrentUser(null);
        setRecoilCurrentUser(null);
        lastSyncedRef.current = null;
      }
    } catch (error) {
      console.error('Error parsing nookies_user cookie:', error);
      
      // Only clear storage/cookies if in browser
      if (typeof window !== 'undefined') {
        localStorage.clear();
      }
    }
  }, [authenticatedUserId, setRecoilCurrentUser]);

  // Sync with Recoil atom updates (so we react to changes from other components)
  useEffect(() => {
    if (
      recoilUser &&
      recoilUser !== lastSyncedRef.current &&
      (authenticatedUserId == null || recoilUser.id === authenticatedUserId)
    ) {
      // HTPR-6853: an equal profile must not republish the local mirror.
      setCurrentUser((current: any) => replaceEqualDeep(current, recoilUser));
      lastSyncedRef.current = recoilUser;
    }
  }, [authenticatedUserId, recoilUser]);

  return currentUser;
};

export default useCurrentUser;