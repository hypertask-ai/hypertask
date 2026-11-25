import { Metadata } from "next";
import UTMCookieHandler from "@/components/analytics/StoreUTM";
import LoginComponent from "./LoginComponent";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isActivationEligible } from "@/lib/telemetry/activationAnalytics";
import SignupPageViewed from "./SignupPageViewed";
import { HTPR_9277_BOAT_DEV_MODEL_FLAG, HTPR_7552_AGENT_CODE_SIGNIN_FLAG, isFeatureEnabled } from "@/lib/flags";


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
		enabled = userId === null ? true : await isActivationEligible(userId);
	} catch {
		enabled = false;
	}
	const boatDevModel = await isFeatureEnabled(HTPR_9277_BOAT_DEV_MODEL_FLAG, userId ?? 0).catch(() => false);
	const agentCodeSignIn = boatDevModel && await isFeatureEnabled(HTPR_7552_AGENT_CODE_SIGNIN_FLAG, userId ?? 0).catch(() => false);
	return (
		<>
			<SignupPageViewed enabled={enabled} userId={userId} />
			<UTMCookieHandler />
			{boatDevModel ? <LoginComponent boatDevModel agentCodeSignIn={agentCodeSignIn} /> : <LoginComponent />}
		</>
	);
};

export default Login;
