import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ReportShell } from "@/app/report/ReportsOverview";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
// This page is server-rendered, so the server-only flag check cannot enter a browser bundle.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { isFeatureEnabled } from "@/lib/flags";
import {
  HTPR_6585_BOARD_REPORTS_FLAG,
  NATIVE_REPORTS_ENABLED,
} from "@/lib/flags/keys";
import type { CurrentTaskCount } from "@/lib/nativeReports/currentTasks";
import type { IUser } from "@/models/model";
import { getCurrentTaskReport } from "@/utils/controllers/reports/reportService";
import { parseProjectSlug } from "@/utils/controllers/taskDetail/load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Current tasks · Hypertask",
};

type PageProps = {
  params: Promise<{ projectSlug: string }>;
};

const CountBreakdown = ({
  title,
  description,
  groups,
}: {
  title: string;
  description: string;
  groups: CurrentTaskCount[];
}) => {
  const maximum = Math.max(1, ...groups.map(({ value }) => value));

  return (
    <section className="min-w-0">
      <div className="mb-3">
        <h2 className="text-subheading font-semibold text-white-black">
          {title}
        </h2>
        <p className="mt-1 text-dense text-text-light-gray">{description}</p>
      </div>
      <div className="rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
        {groups.length === 0 ? (
          <p className="text-dense text-text-light-gray">No current tasks.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="mb-1 flex items-center justify-between gap-3 text-dense">
                  <span className="min-w-0 truncate text-white-black">
                    {group.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-light-gray">
                    {group.value}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-2 overflow-hidden rounded-[2px] bg-pageBackground"
                >
                  <div
                    className="h-full rounded-[2px] bg-hypertasks-header-blue"
                    style={{ width: `${(group.value / maximum) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default async function Page({ params }: PageProps) {
  const user: IUser = await requireServerCookieUser();
  const [boardReportsEnabled, nativeReportsEnabled] = await Promise.all([
    isFeatureEnabled(HTPR_6585_BOARD_REPORTS_FLAG, user.id),
    isFeatureEnabled(NATIVE_REPORTS_ENABLED, user.id),
  ]);
  if (!boardReportsEnabled || !nativeReportsEnabled) {
    notFound();
  }

  const { projectSlug } = await params;
  const projectId = parseProjectSlug(projectSlug);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    redirect("/unauthorized");
  }

  const report = await getCurrentTaskReport({ userId: user.id, projectId });
  if (!report) {
    redirect("/unauthorized");
  }

  const generatedAt = new Date(report.generatedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

  return (
    <ReportShell currentUser={user}>
      <header>
        <h1 className="text-display font-semibold text-white-black">
          Current tasks
        </h1>
        <p className="mt-1 text-emphasis text-white-black">
          {report.boardName}
        </p>
        <p className="mt-2 text-dense text-text-light-gray">
          Live snapshot generated {generatedAt}
        </p>
      </header>

      <section>
        <p className="text-dense text-text-light-gray">Current tasks</p>
        <p className="mt-1 text-display font-semibold tabular-nums text-white-black">
          {report.total}
        </p>
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <CountBreakdown
          description="Every current task appears once in its current section."
          groups={report.sections}
          title="By section"
        />
        <CountBreakdown
          description="Tasks with more than one assignee count once for each person."
          groups={report.assignees}
          title="By assignee"
        />
      </div>
    </ReportShell>
  );
}
