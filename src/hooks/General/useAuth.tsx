import { useFlag } from "@/hooks/useFlag";
import { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG } from "@/lib/flags/keys";

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
import { googleSignupAdditionalData } from "@/lib/analytics/signupIdentityClient";
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
  userData?: any;
  prevBoard?: any;
  isNewUser: boolean;
  skipDatabaseUpdate: boolean;
};

/**
 * @typedef {Object} IAuth
 * @property {HUser|null} currentUser - The current authenticated user or null if not authenticated
 * @property {Function} signupWithGoogle - Function to sign up with Google
 * @property {Function} loginWithGoogle - Function to log in with Google
 */
interface IAuth {
  authenticatedUserId: number | null;
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

const AuthContext = createContext<IAuth>({
  authenticatedUserId: null,
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

export const AuthProvider = ({
  children,
  authenticatedUserId,
}: {
  children: React.ReactNode;
  authenticatedUserId: number | null;
}) => {
  const signupIdentityLinkEnabled = useFlag(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG);
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

  const { data } = useQuery({
    ...getUserProfileQueryOptions(authenticatedAccountId),
    queryFn: fetchUserById,
  });

  const signupWithGoogle = async () => {
    try {
      setIsAuthenticating(true);
      const googleSignupData = await googleSignupAdditionalData(signupIdentityLinkEnabled);
      const { error } = await authClient.signIn.social({
        provider: "google",
        ...googleSignupData,
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

  const loginWithGoogle = async (
    _view?: string | undefined,
    _shouldSkipInteractive: boolean = false,
    _skipOnboarding: boolean = false
  ) => {
    try {
      setIsAuthenticating(true);
      const googleSignupData = await googleSignupAdditionalData(signupIdentityLinkEnabled);
      const { error } = await authClient.signIn.social({
        provider: "google",
        ...googleSignupData,
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
      });
  }, [authenticatedAccountId]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED !== '1' ||
      hasReverseBridgedLegacySession.current
    ) {
      return;
    }

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

      if (isValidUser(nookies.get(null)[authConfig.cookies.user]).isValid) {
        window.location.assign(
          hasProjects === false ? '/onboarding' : authConfig.redirect.afterLogin
        );
      }
    }).catch(() => {
    });
  }, []);

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
        prevBoard = preloadedPrevBoard ?? await getProjects(user.id);
        const activeView = getViewFromProject(prevBoard);
        newView =
          activeView && activeView.type === "Applied"
            ? activeView.view.slug
            : undefined;
      }
  
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
  

      await setCookies_user_theme_prevBoard(
        prevBoard?.id ?? -1,
        user,
        view ?? newView
      );
      if (isNewUser && isMbl) {
        console.log('🚫 Mobile signup detected - showing desktop redirect overlay');
        showMobileOverlay(user.email ?? '');
        const url = getRedirectUrl(
          user,
          prevBoard,
          view ?? newView,
          isMbl,
          taskShared,
          abTestVariant,
          isNewUser
        );
        sessionStorage.setItem('postSignupRedirect', url);
        return;
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
  const joinProjectFromShareURL = async (userId: number, shareId: string) => {
    const response = await axios.post(addUserToTeamFromShareRoute, {
      userId,
      shareId,
    });
    return response;
  };

  const transformUserObject = (user: any): IUser => {
    if (!user) return user;
    
    if (user.notificationPreference !== undefined) {
      return user as IUser;
    }
    
    const transformedUser = {
      ...user,
      notificationPreference: user.UserSetting?.notificationPreference || "direct",
    };
    
    return transformedUser as IUser;
  };

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
      value={{ authenticatedUserId, currentUser, signupWithGoogle, loginWithGoogle, loginWithEmail, isAuthenticating }}
    >
      {children}
    </AuthContext.Provider>
  );
};

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

  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : "";

  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`;


  if (isNewUser && !authConfig.onboarding.skipOnboarding) {
    if (sharedTask) return getSharedTaskUrl();
    if (prevBoard?.id) return getProjectUrl();
    return authConfig.redirect.afterOnboarding;
  }

  return sharedTask ? getSharedTaskUrl() : getProjectUrl();
};

export const useAuth = () => {
  return useContext(AuthContext);
};

export const deleteFunnelCookies = (ctx = null) => {
  nookies.destroy(ctx, authConfig.cookies.funnel);
  nookies.destroy(ctx, authConfig.cookies.funnelTutorialCompleted);
  nookies.destroy(ctx, authConfig.cookies.isFunnelUser);
};
