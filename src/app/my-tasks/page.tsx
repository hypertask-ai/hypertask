import { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { IUser } from "@/models/model";
import getMyTasks from "@/utils/controllers/tasks/myTasks";
import {
  getMyTasksViews,
  myTasksViewsEnabled,
} from "@/utils/controllers/tasks/myTasksViews";
import MyTasks from "./MyTasks";

export const metadata: Metadata = {
  title: "My Tasks",
};

const parseUserCookie = (value: string): IUser | null => {
  try {
    return JSON.parse(value) as IUser;
  } catch {
    return null;
  }
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [cookieStore, requestHeaders, query] = await Promise.all([
    cookies(),
    headers(),
    searchParams,
  ]);
  const userCookie = cookieStore.get("nookies_user")?.value;
  const userObj = userCookie ? parseUserCookie(userCookie) : null;
  const sessionUser = await getSessionUser(new Headers(requestHeaders));
  if (!userObj || !sessionUser || userObj.id !== sessionUser.userId) {
    return redirect("/login");
  }

  const viewsEnabled = await myTasksViewsEnabled(sessionUser.userId);
  const [myTasks, views] = await Promise.all([
    getMyTasks(sessionUser.userId),
    viewsEnabled ? getMyTasksViews(sessionUser.userId) : Promise.resolve([]),
  ]);
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const requestedViewId = rawView && /^\d+$/.test(rawView) ? Number(rawView) : null;
  const initialViewId =
    rawView === undefined
      ? (views.find((view) => view.isDefault)?.id ?? null)
      : (views.find((view) => view.id === requestedViewId)?.id ?? null);

  return (
    <Suspense fallback={<>Loading...</>}>
      <MyTasks
        sections={myTasks.sections}
        tabs={myTasks.tabs}
        boards={myTasks.boards}
        currentUser={userObj}
        initialViews={views}
        initialViewId={initialViewId}
        viewsEnabled={viewsEnabled}
      />
    </Suspense>
  );
}
