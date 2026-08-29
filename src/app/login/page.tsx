import { Metadata } from "next";
import UTMCookieHandler from "@/components/analytics/StoreUTM";
import LoginComponent from "./LoginComponent";


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

const Login = () => {
	return (
		<>
			<UTMCookieHandler />
			<LoginComponent />
		</>
	);
};

export default Login;
