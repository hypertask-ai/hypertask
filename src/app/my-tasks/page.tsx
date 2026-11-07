import { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { effectiveMyTasksScopes } from "@/lib/myTasksScopes";
import { IUser } from "@/models/model";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
} from "@/models/MyTasksView";
import getMyTasks from "@/utils/controllers/tasks/myTasks";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import { getMyTasksViews } from "@/utils/controllers/tasks/myTasksViews";
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

  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const requestedViewId = rawView && /^\d+$/.test(rawView) ? Number(rawView) : null;
  const views = await getMyTasksViews(sessionUser.userId);
  const initialViewId =
    rawView === undefined
      ? (views.find((view) => view.isDefault)?.id ?? null)
      : rawView === "all"
        ? null
        : (views.find((view) => view.id === requestedViewId)?.id ?? null);
  const activeViewConfig = parseMyTasksViewConfig(
    views.find((view) => view.id === initialViewId)?.config ??
      DEFAULT_MY_TASKS_VIEW_CONFIG,
  );
  const scopes = effectiveMyTasksScopes(activeViewConfig.scopes);
  const showSnoozed = activeViewConfig.filters.showSnoozed === true;
  const myTasks = await getMyTasks(sessionUser.userId, true, scopes, {
    snoozeEnabled: true,
    showSnoozed,
  });

  const { json: projects } = await getAllMinimal(
    sessionUser.userId,
    "Calendar",
    false,
  );
  const accessibleProjectIds = projects.map((project) => project.id);

  return (
    <Suspense fallback={<>Loading...</>}>
      <span className="hidden" data-htpr-6461-my-tasks-snooze aria-hidden />
      <span
        className="hidden"
        data-htpr-6459-my-tasks-overdue-badges
        aria-hidden
      />
      <MyTasks
        sections={myTasks.sections}
        tabs={myTasks.tabs}
        boards={myTasks.boards}
        accessibleProjectIds={accessibleProjectIds}
        nearestSnoozeUntil={myTasks.nearestSnoozeUntil ?? null}
        currentUser={userObj}
        initialViews={views}
        initialViewId={initialViewId}
      />
    </Suspense>
  );
}
