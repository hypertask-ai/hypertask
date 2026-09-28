import { Suspense } from "react";
import { Metadata } from "next";
import CalenderView from "@/components/PageComponents/Calendar";
import { CalendarProvider } from "@/lib/contexts/Calendar/calendar.context";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import { calendarDateKeyFromInstant } from "@/lib/calendarInitialDate";

export const metadata: Metadata = {
  title: "Calender",
};

export default async function Page() {
  const userObj = await requireServerCookieUser();
  const initialDateKey = calendarDateKeyFromInstant(new Date());

  return (
    <Suspense fallback={<>Loading...</>}>
      <CalendarProvider
        accountId={userObj.id}
        initialDateKey={initialDateKey}
      >
        <CalenderView currentUser={userObj} />
      </CalendarProvider>
    </Suspense>
  );
}
