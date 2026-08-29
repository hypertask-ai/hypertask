import { Suspense } from "react";
import { Metadata } from "next";
import CalenderView from "@/components/PageComponents/Calendar";
import { CalendarProvider } from "@/lib/contexts/Calendar/calendar.context";
import { requireServerCookieUser } from "@/lib/auth/serverUser";

export const metadata: Metadata = {
  title: "Calender",
};

export default async function Page() {
  const userObj = await requireServerCookieUser();

  return (
    <Suspense fallback={<>Loading...</>}>
      <CalendarProvider accountId={userObj.id}>
        <CalenderView currentUser={userObj} />
      </CalendarProvider>
    </Suspense>
  );
}
