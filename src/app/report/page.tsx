import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
import { resolveBoardRouteTitleRequest } from "@/lib/boardRouteTitle";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server page enforces both report gates before loading report data.
import { isFeatureEnabled } from "@/lib/flags";
import {
  HTPR_6585_BOARD_REPORTS_FLAG,
  NATIVE_REPORTS_ENABLED,
} from "@/lib/flags/keys";
import type { IUser } from "@/models/model";
import { listAllReportsForUser } from "@/utils/controllers/reports/reportService";
import ReportsOverview from "./ReportsOverview";

export const metadata: Metadata = {
  title: "Reports · Hypertask",
};

export default async function Page() {
  const user: IUser = await requireServerCookieUser();
  if (!(await isFeatureEnabled(HTPR_6585_BOARD_REPORTS_FLAG, user.id))) {
    redirect("/unauthorized");
  }

  const cookieStore = await cookies();
  const { projectId } = resolveBoardRouteTitleRequest(
    {},
    cookieStore.get("previousBoard")?.value
  );
  const [data, nativeReportsEnabled] = await Promise.all([
    listAllReportsForUser(user.id, projectId ? Number(projectId) : null),
    isFeatureEnabled(NATIVE_REPORTS_ENABLED, user.id),
  ]);

  return (
    <ReportsOverview
      currentUser={user}
      nativeReportsEnabled={nativeReportsEnabled}
      {...data}
    />
  );
}
