import { Suspense } from "react";
import { Metadata } from "next";
import CalenderView, { CalendarLoadingShell } from "@/components/PageComponents/Calendar";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7397_CALENDAR_LOADING_SHELL_FLAG } from "@/lib/flags/keys";
import { CalendarProvider } from "@/lib/contexts/Calendar/calendar.context";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import CalendarHydrationBoundary from "@/components/PageComponents/Calendar/CalendarHydrationBoundary";

export const metadata: Metadata = {
  title: "Calender",
};

export default async function Page() {
  const userObj = await requireServerCookieUser();
  const keepShell = await isFeatureEnabled(
    HTPR_7397_CALENDAR_LOADING_SHELL_FLAG,
    userObj.id,
  ).catch(() => true);
  const loading = keepShell ? <CalendarLoadingShell currentUser={userObj} /> : undefined;

  return (
    <Suspense fallback={loading ?? <>Loading...</>}>
      <CalendarHydrationBoundary fallback={loading}>
        <CalendarProvider accountId={userObj.id}>
          <CalenderView currentUser={userObj} />
        </CalendarProvider>
      </CalendarHydrationBoundary>
    </Suspense>
  );
}
