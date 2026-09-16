import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6536_QA_LOGIN_FLAG } from "@/lib/flags/keys";
import { isQaLoginConfigured, QA_LOGIN_USER_ID } from "@/lib/auth/qaLogin";
import { QaLoginForm } from "./QaLoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QA test login",
  robots: "noindex, nofollow",
};

export default async function QaLoginPage() {
  if (!isQaLoginConfigured()) notFound();
  let flagged = false;
  try {
    flagged = await isFeatureEnabled(HTPR_6536_QA_LOGIN_FLAG, QA_LOGIN_USER_ID);
  } catch {
    flagged = true;
  }
  if (!flagged) notFound();

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#111214] px-4">
      <section className="flex w-full max-w-[400px] flex-col gap-5">
        <h1 className="text-center text-[22px] font-medium text-white">
          QA test login
        </h1>
        <p className="text-center text-[15px] text-[#8e9093]">
          Sign in as the QA account so a test robot can open the real app.
        </p>
        <QaLoginForm />
      </section>
    </main>
  );
}
