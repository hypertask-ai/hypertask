import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9286_SIGNOUT_PAGE_FLAG } from "@/lib/flags/keys";
import SignOutScreen from "./SignOutScreen";

export const metadata: Metadata = {
  title: "Sign out",
};

export default async function SignOutPage() {
  const session = await getSessionUser(await headers());
  if (!session) redirect("/login");
  if (!(await isFeatureEnabled(HTPR_9286_SIGNOUT_PAGE_FLAG, session.userId))) notFound();
  return <SignOutScreen />;
}
