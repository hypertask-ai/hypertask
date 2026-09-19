"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useContext } from "react";

import BackButton from "@/components/Buttons/BackButton";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  resolveVelocityRange,
  VELOCITY_RANGES,
  velocityVerdict,
  type VelocityGranularity,
  type VelocityReport as VelocityReportData,
} from "@/lib/velocity";
import type { IUser } from "@/models/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";

const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

const formatDays = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return `${formatNumber(rounded)} ${rounded === 1 ? "day" : "days"}`;
};

const formatBucketLabel = (
  start: string,
  granularity: VelocityGranularity
) => {
  const date = new Date(start);
  if (granularity === "hour") {
    return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  if (granularity === "day") {
    return `${date.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    })} ${date.getUTCDate()}`;
  }
  if (granularity === "week") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
};

const formatBucketPeriod = (
  start: string,
  granularity: VelocityGranularity
) => {
  const date = new Date(start);
  if (granularity === "hour") {
    return `${formatBucketLabel(start, granularity)} UTC on ${date.toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    )}`;
  }
  if (granularity === "day") {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (granularity === "week") {
    return `Week of ${formatBucketLabel(start, granularity)}`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatLastActive = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No activity";

const previousPeriod = (report: VelocityReportData) => {
  if (report.range.key === "today") return "the period before today";
  if (report.range.key === "yesterday") return "the day before";
  if (report.range.key === "custom") return "the previous period";
  return report.range.periodLabel.replace(/^the last /, "the previous ");
};

const inPeriod = (report: VelocityReportData) => {
  if (report.range.key === "today") return "Today";
  if (report.range.key === "yesterday") return "Yesterday";
  return `In ${report.range.periodLabel}`;
};

const periodPhrase = (report: VelocityReportData) => {
  if (report.range.key === "today") return "today";
  if (report.range.key === "yesterday") return "yesterday";
  return `in ${report.range.periodLabel}`;
};

const finishTimeComparison = (report: VelocityReportData) => {
  const current = report.speed.medianLeadTimeDays;
  const prior = report.speed.priorMedianLeadTimeDays;
  if (current === null || prior === null) {
    return "No earlier period to compare with";
  }

  const difference = Math.round(Math.abs(current - prior) * 10) / 10;
  if (current < prior) {
    return `${formatDays(difference)} faster than ${previousPeriod(report)}`;
  }
  if (current > prior) {
    return `${formatDays(difference)} slower than ${previousPeriod(report)}`;
  }
  return `Same as ${previousPeriod(report)}`;
};

const finishedComparison = (report: VelocityReportData) => {
  const current = report.speed.completedInRange;
  const prior = report.speed.priorCompletedInRange;
  if (current > prior) {
    return `Up from ${prior} in ${previousPeriod(report)}`;
  }
  if (current < prior) {
    return `Down from ${prior} in ${previousPeriod(report)}`;
  }
  return `Same as ${previousPeriod(report)}`;
};

const isEmptyReport = (report: VelocityReportData) =>
  report.workedOn.length === 0 &&
  report.now.openTotal === 0 &&
  report.buckets.every(
    (bucket) => bucket.created === 0 && bucket.completed === 0
  ) &&
  report.people.every(
    (person) =>
      person.completed === 0 && person.comments === 0
  );

const CreatedFinishedChart = ({ report }: { report: VelocityReportData }) => {
  const maximum = Math.max(
    1,
    ...report.buckets.flatMap((bucket) => [
      bucket.created,
      bucket.completed,
    ])
  );
  const barHeight = (value: number) =>
    value === 0 ? 0 : Math.max(4, (value / maximum) * 100);
  const labelEvery = Math.ceil(report.buckets.length / 12);

  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-subheading font-semibold text-white-black">
            Created vs finished
          </h2>
          <p className="mt-1 text-dense text-text-light-gray">
            Grey is new tickets, blue is tickets finished. Blue taller than
            grey means the backlog is shrinking.
          </p>
        </div>
        <div className="flex items-center gap-4 text-dense text-text-light-gray">
          <span className="flex items-center gap-2">
            <span className="h-2 w-4 rounded-[2px] bg-icon-dark-gray" />
            Created
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-4 rounded-[2px] bg-hypertasks-header-blue" />
            Finished
          </span>
        </div>
      </div>
      {report.now.openTotal > 0 &&
        report.buckets.every((bucket) => bucket.completed === 0) && (
          <p className="mb-3 text-dense text-text-light-gray">
            Nothing was finished in this period. A ticket counts as finished
            once it reaches a column named Done / Completed / Shipped / Closed
            / Finished / Live / Released, or once it is archived.
          </p>
        )}
      <div className="rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
        <div className="w-full max-w-full overflow-x-auto">
          <div className="flex h-48 min-w-[640px] items-end gap-2">
            {report.buckets.map((bucket, index) => {
              const period = formatBucketPeriod(
                bucket.start,
                report.granularity
              );
              const description = `${period}: ${bucket.created} created, ${bucket.completed} finished`;

              return (
                <div
                  key={bucket.start}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-40 w-full items-end justify-center gap-1">
                    <div
                      aria-label={description}
                      className="w-3 rounded-t-[2px] bg-icon-dark-gray sm:w-5"
                      role="img"
                      style={{ height: `${barHeight(bucket.created)}%` }}
                      title={description}
                    />
                    <div
                      aria-label={description}
                      className="w-3 rounded-t-[2px] bg-hypertasks-header-blue sm:w-5"
                      role="img"
                      style={{ height: `${barHeight(bucket.completed)}%` }}
                      title={description}
                    />
                  </div>
                  <span className="truncate text-micro text-text-light-gray">
                    {index % labelEvery === 0
                      ? formatBucketLabel(bucket.start, report.granularity)
                      : " "}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-4 text-dense text-white-black">
          {report.totals.created} created · {report.totals.completed} finished{" "}
          {periodPhrase(report)}
        </p>
      </div>
    </section>
  );
};

const Speed = ({ report }: { report: VelocityReportData }) => {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-subheading font-semibold text-white-black">
          Speed
        </h2>
        <p className="mt-1 text-dense text-text-light-gray">
          {inPeriod(report)}
        </p>
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <div className="min-w-0 rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
          <p className="text-dense text-text-light-gray">
            Time to finish a ticket
          </p>
          <p className="mt-2 text-heading font-semibold text-white-black">
            {report.speed.medianLeadTimeDays === null
              ? "—"
              : formatDays(report.speed.medianLeadTimeDays)}
          </p>
          <p className="mt-1 text-meta text-text-light-gray">
            {report.speed.medianLeadTimeDays === null
              ? `No tickets were finished ${periodPhrase(report)}.`
              : `Half of the tickets finished ${periodPhrase(
                  report
                )} took less than this, half took more.`}
          </p>
          <p className="mt-1 text-meta text-text-light-gray">
            {finishTimeComparison(report)}
          </p>
        </div>
        <div className="min-w-0 rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
          <p className="text-dense text-text-light-gray">
            Tickets finished per week
          </p>
          <p className="mt-2 text-heading font-semibold text-white-black">
            {report.speed.completedPerWeek === null
              ? "—"
              : formatNumber(report.speed.completedPerWeek)}
          </p>
          <p className="mt-1 text-meta text-text-light-gray">
            {inPeriod(report)}: {report.speed.completedInRange} finished in total
          </p>
          <p className="mt-1 text-meta text-text-light-gray">
            {finishedComparison(report)}
          </p>
        </div>
        <div className="min-w-0 rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
          <p className="text-dense text-text-light-gray">
            Oldest ticket still open
          </p>
          <p className="mt-2 text-heading font-semibold text-white-black">
            {report.speed.oldestOpenDays === null
              ? "—"
              : formatDays(report.speed.oldestOpenDays)}
          </p>
          <p className="mt-1 text-meta text-text-light-gray">
            Nothing on the board has been waiting longer than this.
          </p>
        </div>
      </div>
    </section>
  );
};

const OpenTickets = ({ report }: { report: VelocityReportData }) => {
  const maximum = Math.max(
    1,
    ...report.now.columns.map((column) => column.open)
  );

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-subheading font-semibold text-white-black">
          Open tickets
        </h2>
        <span className="text-dense text-text-light-gray">
          {report.now.openTotal} open · {report.now.staleTotal} with no
          movement
        </span>
      </div>
      <div className="rounded-[5px] bg-hoverCardBackground p-4 shadow-md">
        {report.now.columns.length === 0 ? (
          <p className="text-dense text-text-light-gray">No open tickets.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {report.now.columns.map((column) => (
              <div
                key={column.section}
                className="grid grid-cols-[minmax(64px,96px)_minmax(32px,1fr)_auto] items-center gap-2 text-dense sm:grid-cols-[minmax(100px,180px)_1fr_auto] sm:gap-3"
              >
                <span className="truncate text-white-black">
                  {column.section}
                </span>
                <div className="h-2 min-w-0 overflow-hidden rounded-[2px] bg-pageBackground">
                  <div
                    className="h-full rounded-[2px] bg-hypertasks-header-blue"
                    style={{ width: `${(column.open / maximum) * 100}%` }}
                  />
                </div>
                <span className="min-w-[80px] text-right text-text-light-gray">
                  {column.open} open
                  {column.stale > 0 ? ` · ${column.stale} stuck` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

const People = ({ report }: { report: VelocityReportData }) => (
  <section className="min-w-0">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-subheading font-semibold text-white-black">
        Who is active
      </h2>
      <span className="text-dense text-text-light-gray">
        {inPeriod(report)}
      </span>
    </div>
    <div className="w-full max-w-full overflow-x-auto rounded-[5px] bg-hoverCardBackground py-2 shadow-md">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(180px,1fr)_100px_100px_140px] gap-2 px-5 py-2 text-micro font-semibold uppercase text-text-light-gray">
          <span>Member</span>
          <span className="text-right">Finished</span>
          <span className="text-right">Comments</span>
          <span className="text-right">Last comment</span>
        </div>
        {report.people.map((person) => (
          <div
            key={person.userId}
            className="grid grid-cols-[minmax(180px,1fr)_100px_100px_140px] items-center gap-2 rounded-md px-5 py-2 text-dense hover:bg-pageBackground"
          >
            <span className="truncate font-medium text-white-black">
              {person.displayName}
            </span>
            <span className="text-right text-white-black">
              {person.completed}
            </span>
            <span className="text-right text-white-black">
              {person.comments}
            </span>
            <span className="text-right text-text-light-gray">
              {formatLastActive(person.lastActiveAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
    <p className="mt-3 text-meta text-text-light-gray">
      Finished = tickets assigned to that person that reached a done column or
      were archived. Last comment is the most recent comment they wrote.
    </p>
  </section>
);

const WorkedOn = ({ report }: { report: VelocityReportData }) => (
  <section className="min-w-0">
    <div className="mb-3">
      <h2 className="text-subheading font-semibold text-white-black">
        Tickets worked on
      </h2>
      <p className="mt-1 text-dense text-text-light-gray">
        Up to 100 most recently active tickets updated, commented, moved, or
        linked to a pull request merged in this period.
      </p>
    </div>
    {report.workedOn.length === 0 ? (
      <div className="rounded-[5px] bg-hoverCardBackground p-4 text-dense text-text-light-gray shadow-md">
        No tickets were worked on in this period.
      </div>
    ) : (
      <div className="flex flex-col gap-px overflow-hidden rounded-[5px] bg-pageBackground shadow-md">
        {report.workedOn.map((task) => (
          <div
            key={task.id}
            className="min-w-0 bg-hoverCardBackground px-4 py-3"
          >
            <Link
              className="font-medium text-white-black hover:underline"
              href={task.href}
            >
              {task.ticketNumber} {task.title}
            </Link>
            <p className="mt-1 text-meta text-text-light-gray">
              {task.activities.join(" · ")} · {formatLastActive(task.lastActivityAt)}
            </p>
            {task.mergedPullRequests.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta">
                {task.mergedPullRequests.map((pullRequest) => (
                  <a
                    key={pullRequest.url}
                    className="text-hypertasks-header-blue hover:underline"
                    href={pullRequest.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {pullRequest.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </section>
);

const VelocityReport = ({
  boardName,
  currentUser,
  projectId,
}: {
  boardName: string;
  currentUser: IUser;
  projectId: number;
}) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [showCommands] = useRecoilState(showCommandsAtom);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams?.get("from");
  const to = searchParams?.get("to");
  const maxDate = new Date().toISOString().slice(0, 10);
  const range = resolveVelocityRange(searchParams?.get("range"), from, to);
  const customFrom =
    range.key === "custom" ? range.start?.slice(0, 10) ?? from : from;
  const customTo =
    range.key === "custom" ? range.end?.slice(0, 10) ?? to : to;
  const reportParams = new URLSearchParams({
    projectId: String(projectId),
    range: range.key,
  });
  if (range.key === "custom" && customFrom && customTo) {
    reportParams.set("from", customFrom);
    reportParams.set("to", customTo);
  }
  const { data, isError, isLoading } = useQuery<VelocityReportData>({
    queryKey: ["velocityReport", projectId, range.key, customFrom, customTo],
    queryFn: async () => {
      const response = await axios.get<VelocityReportData>(
        `/api/reports/velocity?${reportParams.toString()}`
      );
      return response.data;
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const replaceSearchParams = (
    updates: Record<string, string | null>
  ) => {
    const params = new URLSearchParams(searchParams?.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const selectRange = (key: string) => {
    if (key !== "custom") {
      replaceSearchParams({ range: key, from: null, to: null });
      return;
    }

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    replaceSearchParams({
      range: "custom",
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
  };

  const content = (
    // pt-24 on desktop clears the fixed BackButton (top 40, 40px tall); on
    // mobile that button sits bottom-right instead, so the smaller pad applies.
    <main className="min-h-[100svh] w-full overflow-x-hidden bg-pageBackground px-4 pb-8 pt-8 text-content sm:px-8 sm:pt-24 lg:px-12">
      <div className="mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-8">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-display font-semibold text-white-black">
              Board analytics
            </h1>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {VELOCITY_RANGES.map((rangeOption) => (
                <button
                  key={rangeOption.key}
                  aria-pressed={rangeOption.key === range.key}
                  className={`rounded-[4px] px-2 py-1 text-dense focus:outline-none focus-visible:bg-hoverCardBackground focus-visible:text-white-black ${
                    rangeOption.key === range.key
                      ? "bg-hoverCardBackground text-white-black"
                      : "text-light-gray hover:bg-hoverCardBackground hover:text-white-black"
                  }`}
                  onClick={() => selectRange(rangeOption.key)}
                  type="button"
                >
                  {rangeOption.label}
                </button>
              ))}
            </div>
          </div>
          {range.key === "custom" && customFrom && customTo && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[150px] flex-col gap-1 text-meta text-text-light-gray">
                From
                <input
                  className="h-9 rounded-[4px] bg-newcomment-well px-3 text-dense text-white-black outline-none dark:[&::-webkit-calendar-picker-indicator]:invert"
                  max={customTo < maxDate ? customTo : maxDate}
                  onChange={(event) => {
                    const nextFrom = event.target.value;
                    if (!nextFrom) return;
                    replaceSearchParams({
                      from: nextFrom,
                      ...(nextFrom > customTo ? { to: nextFrom } : {}),
                    });
                  }}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  type="date"
                  value={customFrom}
                />
              </label>
              <label className="flex min-w-[150px] flex-col gap-1 text-meta text-text-light-gray">
                To
                <input
                  className="h-9 rounded-[4px] bg-newcomment-well px-3 text-dense text-white-black outline-none dark:[&::-webkit-calendar-picker-indicator]:invert"
                  max={maxDate}
                  min={customFrom}
                  onChange={(event) => {
                    const nextTo = event.target.value;
                    if (!nextTo) return;
                    replaceSearchParams({
                      to: nextTo,
                      ...(nextTo < customFrom ? { from: nextTo } : {}),
                    });
                  }}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  type="date"
                  value={customTo}
                />
              </label>
            </div>
          )}
          <p className="mt-3 text-emphasis text-white-black">{boardName}</p>
          {data && !isEmptyReport(data) && (
            <p className="mt-2 text-dense text-text-light-gray">
              {velocityVerdict(data)}
            </p>
          )}
        </header>

        {isLoading && (
          <div className="rounded-[5px] bg-hoverCardBackground p-8 text-center text-dense text-text-light-gray shadow-md">
            Loading…
          </div>
        )}

        {isError && (
          <div className="rounded-[5px] bg-hoverCardBackground p-8 text-center text-dense text-text-light-gray shadow-md">
            Unable to load the board analytics.
          </div>
        )}

        {data && isEmptyReport(data) && (
          <div className="rounded-[5px] bg-hoverCardBackground p-8 text-center text-dense text-text-light-gray shadow-md">
            There is nothing to report yet.
          </div>
        )}

        {data && !isEmptyReport(data) && (
          <>
            <WorkedOn report={data} />
            <Speed report={data} />
            <People report={data} />
            <CreatedFinishedChart report={data} />
            <OpenTickets report={data} />
          </>
        )}
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
};

export default VelocityReport;
