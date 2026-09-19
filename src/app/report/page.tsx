import type { Metadata } from "next";
import { cookies } from "next/headers";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
import { resolveBoardRouteTitleRequest } from "@/lib/boardRouteTitle";
import type { IUser } from "@/models/model";
import { listAllReportsForUser } from "@/utils/controllers/reports/reportService";
import ReportsOverview from "./ReportsOverview";

export const metadata: Metadata = {
  title: "Reports · Hypertask",
};

export default async function Page() {
  const user: IUser = await requireServerCookieUser();
  const cookieStore = await cookies();
  const { projectId } = resolveBoardRouteTitleRequest(
    {},
    cookieStore.get("previousBoard")?.value
  );
  const data = await listAllReportsForUser(
    user.id,
    projectId ? Number(projectId) : null
  );

  return <ReportsOverview currentUser={user} {...data} />;
}
