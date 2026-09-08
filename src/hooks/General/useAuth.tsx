/**
 * @fileoverview Authentication module that manages user authentication,
 * handles user data persistence, and manages redirections based on user state.
 *
 * This module provides:
 * - Better Auth Google authentication integration
 * - User data persistence using Recoil state and nookies
 * - Context provider for authentication-related operations
 * - Redirection logic based on user onboarding status
 * - Project invitation and sharing functionality
 *
 * @module Authentication
 */

import { createContext, useContext, useState, useEffect, useRef } from "react";
import nookies from "nookies";

/**
 * @typedef {Object} HUser
 * @property {number} id - User identifier in the application database
 */
interface HUser {
  id: number;
}

import { useRouter, useSearchParams } from "next/navigation";
import { IProject, ITaskShare, IUser } from "@/models/model";
import axios from "axios";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import useCurrentUser from "./useCurrentUserCheckFromCookies";
import { getCurrentUserById } from "@/utils/api/Homepage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { addUserToTeamFromShareRoute } from "@/lib/constants/APIRouteConstants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import authConfig from "@/lib/configs/auth.config";
import { authClient } from "@/lib/auth/betterAuthClient";
import { clearAddAccountFlag } from "@/lib/auth/accounts";
import { useMobileBlocking } from "@/lib/contexts/mobileBlockingContext";
import { isValidUser } from "@/utils/edgeHelpers";
import {
  parseSafeReturnTo,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
  POST_CLI_NEXT_REDIRECT_KEY,
} from "@/lib/auth/safeReturnTo";
import { getUserProfileQueryOptions } from "@/lib/auth/userProfileQuery";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import {
  consumeEarlyAppShellBootstrapSlice,
  waitForEarlyAppShellBootstrap,
} from "@/lib/appShellBootstrap/client";

type TLoginWithEmail = {
  shouldSkipInteractive?: boolean;
  skipOnboarding?: boolean;
  userData?: any; // Pre-processed user data from API
  prevBoard?: any; // Pre-processed project data from API
  isNewUser: boolean; // Flag indicating if this is a new user
  skipDatabaseUpdate: boolean; // Flag to skip calling updateUsers again
};

/**
 * @typedef {Object} IAuth
 * @property {HUser|null} currentUser - The current authenticated user or null if not authenticated
 * @property {Function} signupWithGoogle - Function to sign up with Google
 * @property {Function} loginWithGoogle - Function to log in with Google
 */
interface IAuth {
  currentUser: HUser | null;
  signupWithGoogle: () => Promise<void>;
  loginWithGoogle: (
    view?: string | undefined,
    shouldSkipInteractive?: boolean,
    skipOnboarding?: boolean
  ) => Promise<void>;
  loginWithEmail: ({
    shouldSkipInteractive,
    skipOnboarding,
  }: TLoginWithEmail) => Promise<void>;
  isAuthenticating: boolean;
}

// Create auth context
const AuthContext = createContext<IAuth>({
  currentUser: null,
  signupWithGoogle: () => Promise.resolve(),
  loginWithGoogle: (
    viewId?: string | undefined,
    shouldSkipInteractive?: boolean,
    skipOnboarding?: boolean
  ) => Promise.resolve(),
  loginWithEmail: ({
    shouldSkipInteractive,
    skipOnboarding,
  }: TLoginWithEmail) => Promise.resolve(),
  isAuthenticating: false,
});

/**
 * Authentication Provider component that wraps the application to provide authentication context
 *
 * @component
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 * @returns {JSX.Element} AuthContext Provider with children
 */
export const AuthProvider = ({
  children,
  authenticatedUserId,
}: {
  children: React.ReactNode;
  authenticatedUserId: number | null;
}) => {
  const [________, _setCurrentUser] = useRecoilState(currentUserAtom);
  const currentUserCookie = useCurrentUser(authenticatedUserId);
  const [currentUser, __] = useState<HUser | null>(null);
  const [_, setError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMbl = useContext(MobileViewContext);
  const queryClient = useQueryClient();
  const { showMobileOverlay } = useMobileBlocking();
  const hasBridgedBetterAuthSession = useRef(false);
  const hasReverseBridgedLegacySession = useRef(false);
  const authenticatedAccountId = authenticatedUserId ?? currentUserCookie?.id;
  const isDevelopmentEnv =
    (typeof process !== "undefined" && process.env.development === "true") ||
    process.env.NODE_ENV !== "production";

  /**
   * Query to fetch user data when user cookie is available
   */
  const { data } = useQuery({
    ...getUserProfileQueryOptions(authenticatedAccountId),
    queryFn: fetchUserById,
  });

  

  /**
   * Initiates Google signup process
   *
   * @async
   * @function signupWithGoogle
   * @returns {Promise<void>}
   */
  const signupWithGoogle = async () => {
    try {
      setIsAuthenticating(true);
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: authConfig.redirect.afterLogin,
        errorCallbackURL: "/login?authError=google_signup_disabled",
      });
      if (error) {
        throw new Error(error.message || "Google sign-in failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * Initiates Google login process with optional view and share parameters
   *
   * @async
   * @function loginWithGoogle
   * @param {string} [view] - Optional view identifier to redirect to after login
   * @param {string} [shareId] - Optional share identifier for shared resources
   * @returns {Promise<void>}
   */
  const loginWithGoogle = async (
    _view?: string | undefined,
    _shouldSkipInteractive: boolean = false,
    _skipOnboarding: boolean = false
  ) => {
    try {
      setIsAuthenticating(true);
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: authConfig.redirect.afterLogin,
        errorCallbackURL: "/login?authError=google_signup_disabled",
      });
      if (error) {
        throw new Error(error.message || "Google sign-in failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * Completes email login/signup after the backend has verified the email or code.
   *
   * @async
   * @function loginWithEmail
   * @param {Object} params - Parameters for email login
   * @param {boolean} params.shouldSkipInteractive - Whether to skip interactive onboarding
   * @param {boolean} params.skipOnboarding - Whether to skip onboarding flow
   * @returns {Promise<void>}
   */
  const loginWithEmail = async ({
    skipOnboarding = authConfig.onboarding.skipOnboarding,
    userData,
    prevBoard,
    isNewUser,
  }: TLoginWithEmail) => {
    try {
      setIsAuthenticating(true);
      let abTestVariant: string | undefined = undefined;
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const variant = urlParams.get(authConfig.abTest.urlParam);
        if (variant) {
          abTestVariant = variant;
          console.log("🧪 AB Test Variant detected (email login):", variant);
        }
      } catch (e) {
        console.error("Error parsing URL params:", e);
      }
      // Invalidate projects cache to ensure fresh data (especially for instant signup users)
      queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
      queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] });

      await handlePostAuthUser({
        user: userData,
        preloadedPrevBoard: prevBoard,
        isNewUser,
        view: undefined,
        skipOnboarding,
        abTestVariant,
      });
    } catch (err: any) {
      setError(err.message);
      setIsAuthenticating(false);
    }
  };
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname === 'app.hypertasks.ai') {
      const newUrl = new URL(window.location.href);
      newUrl.hostname = 'app.hypertask.ai';
      window.location.replace(newUrl.toString());
    }
  }, []);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED !== '1' ||
      !authenticatedAccountId ||
      hasBridgedBetterAuthSession.current
    ) {
      return;
    }

    hasBridgedBetterAuthSession.current = true;
    void waitForEarlyAppShellBootstrap(authenticatedAccountId)
      .then((joinedEarlyRequest) => {
        if (joinedEarlyRequest) return;
        return fetch('/api/auth/bridge-session', {
          method: 'POST',
          credentials: 'include',
        });
      })
      .catch(() => {
        // Bridge failures are swallowed so legacy ht_session/nookies_user auth keeps working.
      });
  }, [authenticatedAccountId]);

  // HTPR-4146: reverse of the bridge-session effect above — recovers legacy cookies after a Better Auth magic-link click lands the browser on a fresh page with only a BA session.
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED !== '1' ||
      hasReverseBridgedLegacySession.current
    ) {
      return;
    }

    // currentUserCookie is always null on the first render (useCurrentUser only
    // reads the cookie in a layout effect), so gating on it made every
    // logged-in page load reverse-bridge and hard-navigate in an endless
    // reload loop. Read the cookie synchronously instead, and treat a
    // malformed cookie as absent so the bridge can repair it (HTPR-4146).
    if (isValidUser(nookies.get(null)[authConfig.cookies.user]).isValid) {
      return;
    }

    hasReverseBridgedLegacySession.current = true;
    void fetch('/api/auth/bridge-legacy-session', {
      method: 'POST',
      credentials: 'include',
    }).then(async (response) => {
      if (!response.ok) {
        return;
      }

      const { hasProjects } = await response.json();

      // Navigate only if the legacy cookie actually landed; if the browser
      // rejected it (e.g. oversized), reloading would just loop again.
      if (isValidUser(nookies.get(null)[authConfig.cookies.user]).isValid) {
        window.location.assign(
          hasProjects === false ? '/onboarding' : authConfig.redirect.afterLogin
        );
      }
    }).catch(() => {
      // Anonymous page loads are expected to have no Better Auth session to bridge.
    });
  }, []);

  /**
   * Handles post-authentication user logic for both new and existing users.
   * This function is used in loginWithEmail to process user data,
   * handle onboarding, invitations, analytics, and redirection.
   *
   * @async
   * @function handlePostAuthUser
   * @param {Object} params - Parameters for post-auth logic
   * @param {IUser} params.user - The authenticated user object
   * @param {boolean} params.isNewUser - Whether the user is new
   * @param {string | undefined} params.view - Optional view slug for redirect
   * @param {string | undefined} params.shareId - Optional share identifier
   * @param {boolean} params.skipOnboarding - Whether to skip onboarding
   * @returns {Promise<void>}
   */
  const handlePostAuthUser = async ({
    user,
    preloadedPrevBoard,
    isNewUser,
    view,
    skipOnboarding,
    abTestVariant,
  }: {
    user: IUser;
    preloadedPrevBoard?: IProject;
    isNewUser: boolean;
    view?: string;
    skipOnboarding?: boolean;
    abTestVariant?: string;
  }): Promise<void> => {
    const projectName = searchParams?.get("project");
    const inviteKey = searchParams?.get("key");
    const projectInvite = searchParams?.get("projectId");
    const shareKey = searchParams?.get("shareKey");
    let prevBoard: any;
    let newView: string | undefined;
    let taskShared: ITaskShare | undefined = undefined;
    let teamToInviteTo: Record<string, any> = {};

    try {
      deleteFunnelCookies();
      clearAddAccountFlag();
  
      // Handle project invitation from URL parameters
      if (projectName && projectInvite && inviteKey) {
        const inviteResponse = await joinProject(
          user.id,
          projectInvite,
          inviteKey
        );
        if (inviteResponse?.status !== 200) return;
        const memberData = inviteResponse.data.member;
        const trialStatus = inviteResponse.data.trialStatus;
        prevBoard = {
          id: memberData.projectId,
          team: {
            id: memberData.project.team.id,
            title: memberData.project.team.title,
          },
        };
  
        teamToInviteTo = {
          id: memberData.project.team.id,
          title: memberData.project.team.title,
          stripeId: memberData.project.team.stripe_customer_id,
        };
  
      } else {
        // Get user's projects if no invitation parameters
        prevBoard = preloadedPrevBoard ?? await getProjects(user.id);
        const activeView = getViewFromProject(prevBoard);
        newView =
          activeView && activeView.type === "Applied"
            ? activeView.view.slug
            : undefined;
      }
  
      // Handle joining from a share link
      if (shareKey) {
        try {
          const shareResponse = await joinProjectFromShareURL(user.id, shareKey);
  
          if (shareResponse.status === 200 && shareResponse.data.allowShare) {
            taskShared = shareResponse.data.taskShared;
            prevBoard = {
              ...prevBoard,
              id: shareResponse.data.taskShared.projectId,
            };
          }
        } catch (error) {
          console.error("Error joining project from share URL:", error);
        }
      }
  
      // New users go through /onboarding (team naming + AI board generation);
      // the old auto-create MyTeam/MyBoard shortcut left Google signups boardless
      // and getFirst fabricated an empty project (black board). HTPR-4066

      await setCookies_user_theme_prevBoard(
        prevBoard?.id ?? -1,
        user,
        view ?? newView
      );
      // Check if this is a new mobile user - if so, show the blocking overlay
      if (isNewUser && isMbl) {
        console.log('🚫 Mobile signup detected - showing desktop redirect overlay');
        showMobileOverlay(user.email ?? '');
        // Still calculate the URL for when they dismiss the overlay
        const url = getRedirectUrl(
          user,
          prevBoard,
          view ?? newView,
          isMbl,
          taskShared,
          abTestVariant,
          isNewUser
        );
        // Store the intended redirect URL for later
        sessionStorage.setItem('postSignupRedirect', url);
        return; // Don't redirect yet
      }

      const hasOAuthMcp = searchParams?.has("client_id") && searchParams?.has("redirect_uri");
      if (!hasOAuthMcp && typeof window !== "undefined") {
        const cliResume = parseSafeReturnTo(
          sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
        );
        if (cliResume) {
          if (!isMbl && isNewUser) {
            const postCliNext = getRedirectUrl(
              user,
              prevBoard,
              view ?? newView,
              isMbl,
              taskShared,
              abTestVariant,
              isNewUser
            );
            if (postCliNext.startsWith("/interactive-onboarding/")) {
              localStorage.setItem(POST_CLI_NEXT_REDIRECT_KEY, postCliNext);
            } else {
              localStorage.removeItem(POST_CLI_NEXT_REDIRECT_KEY);
            }
          } else {
            localStorage.removeItem(POST_CLI_NEXT_REDIRECT_KEY);
          }
          sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
          router.push(cliResume);
          return;
        }
      }

      const url = getRedirectUrl(
        user,
        prevBoard,
        view ?? newView,
        isMbl,
        taskShared,
        abTestVariant,
        isNewUser
      );
      router.push(url);
    } catch (error) {
      setIsAuthenticating(false);
      console.error("Error in post-authentication handling:", error);
      
    }
    finally{
      setIsAuthenticating(false);

    }
    
  };
  /**
   * Adds a user to a team from a share URL
   *
   * @async
   * @function joinProjectFromShareURL
   * @param {number} userId - User ID to add to the team
   * @param {string} shareId - Share identifier
   * @returns {Promise<any>} API response
   */
  const joinProjectFromShareURL = async (userId: number, shareId: string) => {
    const response = await axios.post(addUserToTeamFromShareRoute, {
      userId,
      shareId,
    });
    return response;
  };

  // Import transformUserObject from utils
  const transformUserObject = (user: any): IUser => {
    if (!user) return user;
    
    // If notificationPreference already exists at top level, return as is
    if (user.notificationPreference !== undefined) {
      return user as IUser;
    }
    
    // Flatten notificationPreference from UserSetting to top level
    const transformedUser = {
      ...user,
      notificationPreference: user.UserSetting?.notificationPreference || "direct",
    };
    
    return transformedUser as IUser;
  };

  /**
   * Updates user data in cookies and Recoil atom
   *
   * @async
   * @function setUserCookieAndAtom
   * @param {IUser} user - User data to store
   */
  const setUserCookieAndAtom = async (user: IUser) => {
    const transformedUser = transformUserObject(user);
    nookies.set(
      null,
      authConfig.cookies.user,
      JSON.stringify(slimUserForCookie(transformedUser)),
      {
        maxAge: authConfig.cookies.maxAge,
        path: authConfig.cookies.options.path,
      },
    );
    _setCurrentUser(transformedUser);
  };

  /**
   * Sets multiple cookies for user session, theme preferences, and board selection
   *
   * @async
   * @function setCookies_user_theme_prevBoard
   * @param {number} prevBoardId - Previous board ID
   * @param {IUser} user - User data
   * @param {string} [view] - Optional view identifier
   * @returns {Promise<void>}
   */
  const setCookies_user_theme_prevBoard = async (
    prevBoardId: number,
    user: IUser,
    view?: string
  ) => {
    const existingCookies = nookies.get(null);
    const existingTheme = existingCookies.theme;

    if (prevBoardId) {
      nookies.set(
        null,
        authConfig.cookies.previousBoard,
        `project-${prevBoardId}|&|${view}`,
        {
          maxAge: authConfig.cookies.maxAge,
          path: authConfig.cookies.options.path,
        }
      );
    }

    if (!existingTheme) {
      nookies.set(
        null,
        authConfig.cookies.theme,
        authConfig.cookies.defaultTheme,
        {
          maxAge: authConfig.cookies.maxAge,
          path: authConfig.cookies.options.path,
        }
      );
    }

    setUserCookieAndAtom(user);
    await router.refresh();
    return;
  };

  /**
   * Retrieves all projects for a given user
   *
   * @async
   * @function getProjects
   * @param {number} userId - User ID
   * @returns {Promise<IProject|undefined>} First project of the user or undefined
   */
  const getProjects = async (userId: number) => {
    const response = await fetch(`/api/projects/getAll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId }),
    });
    if (response.ok) {
      const data: IProject[] = await response.json();
      return data[0];
    }
  };

  /**
   * Adds a user to a project using an invite key
   *
   * @async
   * @function joinProject
   * @param {number} userId - User ID to add to the project
   * @param {string} projectId - Project ID to join
   * @param {string} inviteKey - Invitation key
   * @returns {Promise<any|null>} API response or null if parameters are missing
   */
  const joinProject = async (
    userId: number,
    projectId: string,
    inviteKey: string
  ) => {
    if (!userId || !projectId || !inviteKey) return null;
    const response = await axios.post("/api/members/invite", {
      projectId: parseInt(projectId),
      userId: userId,
      invokeInvite: true,
      inviteKey: inviteKey,
    });

    if (response.status === 101) {
      console.log("user was already a part of this project");
    }
    return response;
  };

  /**
   * Fetches user data by ID from the API
   *
   * @async
   * @function fetchUserById
   * @returns {Promise<void>}
   */
  async function fetchUserById() {
    try {
      const bootstrappedUser =
        await consumeEarlyAppShellBootstrapSlice<IUser>(
          "user",
          authenticatedAccountId,
        );
      let userData = bootstrappedUser;
      if (bootstrappedUser?.id !== authenticatedAccountId) {
        const response = await getCurrentUserById(authenticatedAccountId);
        if (response.status !== 200) {
          throw new Error("Failed to fetch user data.");
        }
        userData = response.data;
      }
      const transformedUser = transformUserObject(userData);
      setUserCookieAndAtom(transformedUser);
      return transformedUser;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AuthContext.Provider
      value={{ currentUser, signupWithGoogle, loginWithGoogle, loginWithEmail, isAuthenticating }}
    >
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Determines the appropriate redirect URL based on user state and parameters
 *
 * @function getRedirectUrl
 * @param {any} user - User object with settings
 * @param {any} prevBoard - Previous board object
 * @param {boolean} isMobile - Whether the device is mobile
 * @param {string|undefined} view - Optional view identifier
 * @param {ITaskShare|undefined} sharedTask - Optional shared task
 * @param {string|undefined} abTestVariant - Optional AB test variant
 * @param {boolean|undefined} isNewUser - Whether this is a new user
 * @returns {string} URL to redirect to
 */
const getRedirectUrl = (
  user: any,
  prevBoard: any,
  view: string | undefined,
  isMobile: boolean,
  sharedTask: ITaskShare | undefined,
  abTestVariant?: string,
  isNewUser?: boolean
): string => {
  const { onboardingTourStatus, isVerified } = user?.UserSetting || {};
  console.log(
    "🤔 ~ getRedirectUrl ~ onboardingTourStatus:",
    onboardingTourStatus
  );
  console.log("🧪 ~ getRedirectUrl ~ abTestVariant:", abTestVariant);
  console.log("👤 ~ getRedirectUrl ~ isNewUser:", isNewUser);
  console.log("✅ ~ getRedirectUrl ~ isVerified:", isVerified);

  // Shared task URL generation helper
  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : "";

  // Project URL with optional view parameter
  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`;

  // // For instant signup users (isVerified: false), skip onboarding and go straight to app
  // // They will see the verification modal instead
  // if (isVerified === false) {
  //   console.log("🔐 Instant signup user - skipping onboarding, going to app");
  //   return sharedTask ? getSharedTaskUrl() : getProjectUrl();
  // }

  // New users go through the /onboarding flow only when skipOnboarding is off.
  // With it on (2026-08-02), a boardless signup lands on NoBoardsEmptyState.
  // Invited/shared users already have a board to land on. HTPR-4066
  if (isNewUser && !authConfig.onboarding.skipOnboarding) {
    if (sharedTask) return getSharedTaskUrl();
    if (prevBoard?.id) return getProjectUrl();
    return authConfig.redirect.afterOnboarding;
  }

  // User has completed all onboarding steps
  return sharedTask ? getSharedTaskUrl() : getProjectUrl();

  // // User has not completed onboarding
  // return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
  //   prevBoard?.team.title
  // }&id=${prevBoard?.team.id}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`;
};

/**
 * Custom hook to access authentication context
 *
 * @function useAuth
 * @returns {IAuth} Authentication context
 */
export const useAuth = () => {
  return useContext(AuthContext);
};

export const deleteFunnelCookies = (ctx = null) => {
  nookies.destroy(ctx, authConfig.cookies.funnel);
  nookies.destroy(ctx, authConfig.cookies.funnelTutorialCompleted);
  nookies.destroy(ctx, authConfig.cookies.isFunnelUser);
};
