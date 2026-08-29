import { parseCookies } from "nookies";

const DEMO_USER = {
    id: 0,
    displayName: "Demo User",
    email: "demo@hypertask.ai",
    photoURL: "/default-avatar.png",
    UserSetting: {
        onboardingTutorialStatus: false,
    },
};

export function getCurrentUserFromCookies(pathname?: string) {
    // if (!pathname || !pathname.startsWith("/interactive-onboarding")) {
    //     throw new Error("Demo user is only available on interactive-onboarding routes");
    // }
    const cookies = parseCookies();
    try {
        return cookies.nookies_user ? JSON.parse(cookies.nookies_user) : DEMO_USER;
    } catch {
        return DEMO_USER;
    }
}