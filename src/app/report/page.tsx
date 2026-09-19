import type { Metadata } from "next";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
// This page is server-rendered, so the server-only flag check cannot enter a browser bundle.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { isFeatureEnabled } from "@/lib/flags";
import { NATIVE_REPORTS_ENABLED } from "@/lib/flags/keys";
import type { IUser } from "@/models/model";
import { listAllReportsForUser } from "@/utils/controllers/reports/reportService";
import ReportsOverview from "./ReportsOverview";

export const metadata: Metadata = {
  title: "Reports · Hypertask",
};

export default async function Page() {
  const user: IUser = await requireServerCookieUser();
  const [data, nativeReportsEnabled] = await Promise.all([
    listAllReportsForUser(user.id),
    isFeatureEnabled(NATIVE_REPORTS_ENABLED, user.id),
  ]);

  return nativeReportsEnabled ? (
    <ReportsOverview
      currentUser={user}
      nativeReportsEnabled
      {...data}
    />
  ) : (
    <ReportsOverview
      currentUser={user}
      nativeReportsEnabled={false}
      {...data}
    />
  );
}
