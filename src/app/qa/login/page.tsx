import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { shouldShowMobileTabBar } from "@/components/Global/mobileShellVisibility";
import { isQaLoginConfigured, QA_LOGIN_USER_ID } from "@/lib/auth/qaLogin";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6536_QA_LOGIN_FLAG } from "@/lib/flags/keys";
import { QaLoginForm } from "./QaLoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QA test login",
  robots: "noindex, nofollow",
};

export default async function QaLoginPage() {
  if (!isQaLoginConfigured()) notFound();

  try {
    const flagged = await isFeatureEnabled(
      HTPR_6536_QA_LOGIN_FLAG,
      QA_LOGIN_USER_ID,
    );
    if (!flagged) notFound();
  } catch {
    notFound();
  }

  if (shouldShowMobileTabBar("/qa/login")) {
    console.error("[qa-login] expected /qa/login to hide the mobile shell");
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-pageBackground px-5">
      <section className="flex w-full max-w-[400px] flex-col gap-5">
        <h1 className="text-center text-heading font-medium text-white-black">
          QA test login
        </h1>
        <p className="text-center text-content text-text-light-gray">
          Sign in as the QA account so a test robot can open the real app.
        </p>
        <QaLoginForm />
      </section>
    </main>
  );
}
