import { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/getSessionUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";
import {
  MY_TASKS_LIVE_UPDATES_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
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

  const [viewsEnabled, scopesEnabled, liveUpdatesEnabled] = await Promise.all([
    isFeatureEnabled(MY_TASKS_VIEWS_FLAG, sessionUser.userId),
    isFeatureEnabled(MY_TASKS_SCOPES_FLAG, sessionUser.userId),
    isFeatureEnabled(MY_TASKS_LIVE_UPDATES_FLAG, sessionUser.userId),
  ]);
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const requestedViewId = rawView && /^\d+$/.test(rawView) ? Number(rawView) : null;

  let views: Awaited<ReturnType<typeof getMyTasksViews>> = [];
  let myTasks: Awaited<ReturnType<typeof getMyTasks>>;

  if (!scopesEnabled) {
    // Assigned-only query does not need saved view config; load in parallel.
    const [tasksResult, viewsResult] = await Promise.all([
      getMyTasks(sessionUser.userId, viewsEnabled),
      viewsEnabled
        ? getMyTasksViews(sessionUser.userId)
        : Promise.resolve([] as Awaited<ReturnType<typeof getMyTasksViews>>),
    ]);
    myTasks = tasksResult;
    views = viewsResult;
  } else {
    views = viewsEnabled ? await getMyTasksViews(sessionUser.userId) : [];
  }

  const initialViewId =
    rawView === undefined
      ? (views.find((view) => view.isDefault)?.id ?? null)
      : rawView === "all"
        ? null
        : (views.find((view) => view.id === requestedViewId)?.id ?? null);

  if (scopesEnabled) {
    const scopes = effectiveMyTasksScopes(
      parseMyTasksViewConfig(
        views.find((view) => view.id === initialViewId)?.config ??
          DEFAULT_MY_TASKS_VIEW_CONFIG,
      ).scopes,
      true,
    );
    myTasks = await getMyTasks(sessionUser.userId, viewsEnabled, scopes);
  }

  let accessibleProjectIds: number[] = [];
  if (liveUpdatesEnabled) {
    const { json: projects } = await getAllMinimal(
      sessionUser.userId,
      "Calendar",
      false,
    );
    accessibleProjectIds = projects.map((project) => project.id);
  }

  return (
    <Suspense fallback={<>Loading...</>}>
      {scopesEnabled ? (
        <MyTasks
          sections={myTasks.sections}
          tabs={myTasks.tabs}
          boards={myTasks.boards}
          accessibleProjectIds={accessibleProjectIds}
          currentUser={userObj}
          initialViews={viewsEnabled ? views : []}
          initialViewId={initialViewId}
          viewsEnabled={viewsEnabled}
          scopesEnabled
        />
      ) : (
        <MyTasks
          sections={myTasks.sections}
          tabs={myTasks.tabs}
          boards={myTasks.boards}
          accessibleProjectIds={accessibleProjectIds}
          currentUser={userObj}
          initialViews={viewsEnabled ? views : []}
          initialViewId={initialViewId}
          viewsEnabled={viewsEnabled}
          scopesEnabled={false}
        />
      )}
    </Suspense>
  );
}
