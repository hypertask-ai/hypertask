"use client"
import { currentUserAtom } from "@/store";
import { isValidUser } from "@/utils/edgeHelpers";
import { parseCookies } from "nookies";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";

const useCurrentUser = () => {
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
      
      if (isValid && user) {
        setCurrentUser(user);
        setRecoilCurrentUser(user);
        lastSyncedRef.current = user;
      } else {
        // throw new Error("Invalid user");
      }
    } catch (error) {
      console.error('Error parsing nookies_user cookie:', error);
      
      // Only clear storage/cookies if in browser
      if (typeof window !== 'undefined') {
        localStorage.clear();
      }
    }
  }, [setRecoilCurrentUser]); // Include setRecoilCurrentUser for completeness

  // Sync with Recoil atom updates (so we react to changes from other components)
  useEffect(() => {
    if (recoilUser && recoilUser !== lastSyncedRef.current) {
      setCurrentUser(recoilUser);
      lastSyncedRef.current = recoilUser;
    }
  }, [recoilUser]);

  return currentUser;
};

export default useCurrentUser;