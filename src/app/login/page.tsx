import { Metadata } from "next";
import UTMCookieHandler from "@/components/analytics/StoreUTM";
import LoginComponent from "./LoginComponent";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG } from "@/lib/flags/keys";
import { isActivationEligible } from "@/lib/telemetry/activationAnalytics";
import SignupPageViewed from "./SignupPageViewed";


export const metadata: Metadata = {
	title: "Sign up - Hypertask",
	description: "Supercharge your workflow with AI-driven task management. Join Hypertask for free, get started in seconds.",
	keywords: ["AI task management", "productivity app", "workflow automation", "team collaboration", "project management"],
	openGraph: {
		title: "Sign up - Hypertask",
		description: "Supercharge your workflow with AI-driven task management. Join Hypertask for free, get started in seconds.",
		type: "website",
		url: "https://hypertask.ai/signup",
		siteName: "Hypertask",
	},
	twitter: {
		card: "summary_large_image",
		title: "Sign up - Hypertask",
		description: "Supercharge your workflow with AI-driven task management. Join Hypertask for free, get started in seconds.",
	},
	robots: "index, follow",
};

const Login = async () => {
	const cookieStore = await cookies();
	const analyticsSession = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
	const userId = analyticsSession?.id ?? null;
	let enabled = false;
	try {
		const { featureFlagCandidateUserIds, isFeatureEnabled } = await import("@/lib/flags");
		enabled = userId === null
			? await featureFlagCandidateUserIds(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG) === null
			: await isFeatureEnabled(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, userId) && await isActivationEligible(userId);
	} catch {
		enabled = false;
	}
	return (
		<>
			<SignupPageViewed enabled={enabled} userId={userId} />
			<UTMCookieHandler />
			<LoginComponent />
		</>
	);
};

export default Login;
