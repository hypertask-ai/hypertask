import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server layout enforces the report gate before rendering children.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6585_BOARD_REPORTS_FLAG } from "@/lib/flags/keys";

export default async function ReportsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireServerCookieUser();
  if (!(await isFeatureEnabled(HTPR_6585_BOARD_REPORTS_FLAG, user.id))) {
    redirect("/unauthorized");
  }

  return children;
}
