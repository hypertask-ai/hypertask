import { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/getSessionUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";
import {
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

  const [viewsEnabled, scopesEnabled] = await Promise.all([
    isFeatureEnabled(MY_TASKS_VIEWS_FLAG, sessionUser.userId),
    isFeatureEnabled(MY_TASKS_SCOPES_FLAG, sessionUser.userId),
  ]);
  const views = viewsEnabled
    ? await getMyTasksViews(sessionUser.userId)
    : [];
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const requestedViewId = rawView && /^\d+$/.test(rawView) ? Number(rawView) : null;
  const initialViewId =
    rawView === undefined
      ? (views.find((view) => view.isDefault)?.id ?? null)
      : rawView === "all"
        ? null
        : (views.find((view) => view.id === requestedViewId)?.id ?? null);
  const initialView = views.find((view) => view.id === initialViewId);
  const initialConfig = parseMyTasksViewConfig(
    initialView?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG,
  );
  const scopes = effectiveMyTasksScopes(initialConfig.scopes, scopesEnabled);
  const myTasks = await getMyTasks(
    sessionUser.userId,
    viewsEnabled,
    scopes,
  );

  return (
    <Suspense fallback={<>Loading...</>}>
      <MyTasks
        sections={myTasks.sections}
        tabs={myTasks.tabs}
        boards={myTasks.boards}
        currentUser={userObj}
        initialViews={viewsEnabled ? views : []}
        initialViewId={initialViewId}
        viewsEnabled={viewsEnabled}
        scopesEnabled={scopesEnabled}
      />
    </Suspense>
  );
}
