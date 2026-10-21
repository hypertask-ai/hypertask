"use client"
import { currentUserAtom } from "@/store";
import { isValidUser } from "@/utils/edgeHelpers";
import { parseCookies } from "nookies";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";

const useCurrentUser = (authenticatedUserId?: number | null) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [_, setRecoilCurrentUser] = useRecoilState(currentUserAtom);
  const recoilUser = useRecoilValue(currentUserAtom);
  const lastSyncedRef = useRef<any>(null);
  
  useLayoutEffect(() => {
    try {
      const cookies = parseCookies();
      const { isValid, user } = isValidUser(cookies?.nookies_user);
      
      if (
        isValid &&
        user &&
        (authenticatedUserId == null || user.id === authenticatedUserId)
      ) {
        setCurrentUser(user);
        setRecoilCurrentUser(user);
        lastSyncedRef.current = user;
      } else if (authenticatedUserId != null) {
        setCurrentUser(null);
        setRecoilCurrentUser(null);
        lastSyncedRef.current = null;
      }
    } catch (error) {
      console.error('Error parsing nookies_user cookie:', error);
      
      if (typeof window !== 'undefined') {
        localStorage.clear();
      }
    }
  }, [authenticatedUserId, setRecoilCurrentUser]);

  useEffect(() => {
    if (
      recoilUser &&
      recoilUser !== lastSyncedRef.current &&
      (authenticatedUserId == null || recoilUser.id === authenticatedUserId)
    ) {
      setCurrentUser(recoilUser);
      lastSyncedRef.current = recoilUser;
    }
  }, [authenticatedUserId, recoilUser]);

  return currentUser;
};

export default useCurrentUser;