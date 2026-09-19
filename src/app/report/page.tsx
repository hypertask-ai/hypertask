import type { Metadata } from "next";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
import type { IUser } from "@/models/model";
import {
  listAllReportsForUser,
  nativeReportsEnabledForUser,
} from "@/utils/controllers/reports/reportService";
import ReportsOverview from "./ReportsOverview";

export const metadata: Metadata = {
  title: "Reports · Hypertask",
};

export default async function Page() {
  const user: IUser = await requireServerCookieUser();
  const [data, nativeReportsEnabled] = await Promise.all([
    listAllReportsForUser(user.id),
    nativeReportsEnabledForUser(user.id),
  ]);

  return (
    <ReportsOverview
      currentUser={user}
      nativeReportsEnabled={nativeReportsEnabled}
      {...data}
    />
  );
}
