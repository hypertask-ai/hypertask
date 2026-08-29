import type { Metadata } from "next";
import { redirect } from "next/navigation";

import RelativeTime from "@/components/Common/RelativeTime";
import { HtmlCanvasFrame } from "@/components/RTE/Extensions/HtmlBlock/HtmlCanvasFrame";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import type { IUser } from "@/models/model";
import {
  getReport,
  normalizeReportSlug,
  REPORT_SLUG_RE,
} from "@/utils/controllers/reports/reportService";
import { parseProjectSlug } from "@/utils/controllers/taskDetail/load";
import { ReportShell } from "../../ReportsOverview";

type PageProps = {
  params: Promise<{ projectSlug: string; reportSlug: string }>;
};

async function loadReport({ params }: PageProps) {
  const user: IUser = await requireServerCookieUser();
  const { projectSlug, reportSlug } = await params;
  const projectId = parseProjectSlug(projectSlug);
  const slug = normalizeReportSlug(reportSlug);

  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !slug ||
    !REPORT_SLUG_RE.test(slug)
  ) {
    redirect("/unauthorized");
  }

  const report = await getReport({ userId: user.id, projectId, slug });
  if (!report) {
    redirect("/unauthorized");
  }

  return { report, user };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { report } = await loadReport(props);
  return { title: `${report.title} · Hypertask` };
}

export default async function Page(props: PageProps) {
  const { report, user } = await loadReport(props);

  return (
    <ReportShell currentUser={user}>
      <header>
        <h1 className="text-display font-semibold text-white-black">
          {report.title}
        </h1>
        {report.description && (
          <p className="mt-2 text-dense text-text-light-gray">
            {report.description}
          </p>
        )}
        <p className="mt-2 text-micro text-text-light-gray">
          {report.boardName} · Updated <RelativeTime date={report.updatedAt} /> ·{" "}
          {report.creator.name}
        </p>
      </header>
      <HtmlCanvasFrame
        className="block w-full rounded-[4px] bg-white"
        html={report.bodyHtml}
        title={report.title}
      />
    </ReportShell>
  );
}
