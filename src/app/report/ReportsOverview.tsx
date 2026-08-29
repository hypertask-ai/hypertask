"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useContext } from "react";

import BackButton from "@/components/Buttons/BackButton";
import RelativeTime from "@/components/Common/RelativeTime";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import type { IUser } from "@/models/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import type { ReportCreator } from "@/utils/controllers/reports/reportService";

const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

type ReportRow = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  projectId: number;
  boardName: string;
  updatedAt: Date;
  href: string;
  creator: ReportCreator;
};

type BuiltinRow = {
  projectId: number;
  boardName: string;
  title: "Velocity";
  description: "Throughput, lead time, and who is active";
  href: string;
};

export function ReportShell({
  currentUser,
  children,
}: {
  currentUser: IUser;
  children: ReactNode;
}) {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [showCommands] = useRecoilState(showCommandsAtom);

  const content = (
    // pt-24 on desktop clears the fixed BackButton (top 40, 40px tall); on
    // mobile that button sits bottom-right instead, so the smaller pad applies.
    <main className="min-h-[100svh] w-full overflow-x-hidden bg-pageBackground px-4 pb-8 pt-8 text-content sm:px-8 sm:pt-24 lg:px-12">
      <div className="mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-8">
        {children}
      </div>
    </main>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div> : content}
      <BackButton left={appShellRailOn ? 56 : undefined} />
      {showCommands.show && <HypertasksCommands />}
    </>
  );
}

const ReportsOverview = ({
  currentUser,
  reports,
  builtins,
}: {
  currentUser: IUser;
  reports: ReportRow[];
  builtins: BuiltinRow[];
}) => (
  <ReportShell currentUser={currentUser}>
    <header>
      <h1 className="text-display font-semibold text-white-black">Reports</h1>
      <p className="mt-2 text-dense text-text-light-gray">
        Saved reports and board velocity in one place.
      </p>
    </header>

    <section>
      <h2 className="mb-3 text-subheading font-semibold text-white-black">
        Reports
      </h2>
      {reports.length === 0 ? (
        <div className="rounded-[4px] bg-hoverCardBackground p-5 text-dense text-text-light-gray">
          Reports are created by asking the AI chat or an agent.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((report) => (
            <Link
              key={report.id}
              className="rounded-[4px] bg-hoverCardBackground px-5 py-4 hover:bg-cardBackground"
              href={report.href}
            >
              <p className="text-emphasis font-semibold text-white-black">
                {report.title}
              </p>
              <p className="mt-1 text-meta text-text-light-gray">
                {report.description ?? "No description"}
              </p>
              <p className="mt-2 text-micro text-text-light-gray">
                {report.boardName} · Updated {" "}
                <RelativeTime date={report.updatedAt} /> · {report.creator.name}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>

    <section>
      <h2 className="mb-3 text-subheading font-semibold text-white-black">
        Velocity
      </h2>
      <div className="flex flex-col gap-2">
        {builtins.map((report) => (
          <Link
            key={report.projectId}
            className="rounded-[4px] bg-hoverCardBackground px-5 py-4 hover:bg-cardBackground"
            href={report.href}
          >
            <p className="text-emphasis font-semibold text-white-black">
              {report.title}
            </p>
            <p className="mt-1 text-meta text-text-light-gray">
              {report.description}
            </p>
            <p className="mt-2 text-micro text-text-light-gray">
              {report.boardName}
            </p>
          </Link>
        ))}
      </div>
    </section>
  </ReportShell>
);

export default ReportsOverview;
