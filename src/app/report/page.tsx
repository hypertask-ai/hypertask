import type { Metadata } from "next";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
import type { IUser } from "@/models/model";
import { listAllReportsForUser } from "@/utils/controllers/reports/reportService";
import ReportsOverview from "./ReportsOverview";

export const metadata: Metadata = {
  title: "Reports · Hypertask",
};

export default async function Page() {
  const user: IUser = await requireServerCookieUser();
  const data = await listAllReportsForUser(user.id);

  return <ReportsOverview currentUser={user} {...data} />;
}
