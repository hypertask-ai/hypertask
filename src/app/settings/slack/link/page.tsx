import type { Metadata } from "next";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import {
  verifySlackLinkConfirmation,
  verifySlackLinkState,
} from "@/lib/slack/linkState";
import { isSlackInstallTeamMember } from "@/lib/slack/userLink";

export const metadata: Metadata = { title: "Connect Slack" };

export default async function SlackLinkPage(props: {
  searchParams: Promise<{
    confirmation?: string;
    state?: string;
    status?: string;
  }>;
}) {
  const user = await requireServerCookieUser("/login");
  const searchParams = await props.searchParams;
  const status = searchParams.status;

  if (status) {
    const success = status === "linked";
    return (
      <LinkPageShell>
        <h1 className="text-heading font-semibold text-white-black">
          {success ? "Slack connected" : "Slack could not be connected"}
        </h1>
        <p className="text-dense font-medium leading-relaxed text-text-light-gray">
          {success
            ? "Your Slack account now uses your Hypertask identity. You can close this tab and return to Slack."
            : linkErrorMessage(status)}
        </p>
      </LinkPageShell>
    );
  }

  const confirmation = verifySlackLinkConfirmation(
    searchParams.confirmation,
    process.env.SLACK_CLIENT_SECRET,
  );
  if (confirmation) {
    const canConfirm =
      confirmation.userId === user.id &&
      (await isSlackInstallTeamMember(confirmation.installId, user.id));
    return (
      <LinkPageShell>
        <h1 className="text-heading font-semibold text-white-black">
          Confirm in Slack
        </h1>
        {canConfirm ? (
          <>
            <p className="text-dense font-medium leading-relaxed text-text-light-gray">
              Hypertask verified your account. Return to the same Slack account
              that opened this page and run this private slash command:
            </p>
            <code className="break-all rounded-[5px] bg-pageBackground p-3 text-dense text-white-black">
              /ht connect {searchParams.confirmation}
            </code>
            <p className="text-dense font-medium leading-relaxed text-text-light-gray">
              The confirmation expires in 10 minutes and works once.
            </p>
          </>
        ) : (
          <p className="text-dense font-medium leading-relaxed text-text-light-gray">
            This confirmation is invalid, expired, or belongs to another
            Hypertask account. Run <code>/ht connect</code> in Slack again.
          </p>
        )}
      </LinkPageShell>
    );
  }

  const state = verifySlackLinkState(
    searchParams.state,
    process.env.SLACK_CLIENT_SECRET,
  );
  const install = state
    ? await prisma.slackInstall.findUnique({
        where: { id: state.installId },
        select: { slackTeamName: true },
      })
    : null;
  const canLink = Boolean(
    state && install && (await isSlackInstallTeamMember(state.installId, user.id)),
  );

  return (
    <LinkPageShell>
      <h1 className="text-heading font-semibold text-white-black">
        Connect your Slack account
      </h1>
      {canLink ? (
        <>
          <p className="text-dense font-medium leading-relaxed text-text-light-gray">
            Confirm <strong className="text-white-black">{user.email}</strong>{" "}
            for <strong className="text-white-black">{install!.slackTeamName}</strong>.
            You will finish the connection from the same Slack account.
          </p>
          <form action="/api/slack/link" method="post">
            <input name="state" type="hidden" value={searchParams.state} />
            <button
              className="rounded-[5px] bg-hypertasks-purple px-3 py-2 text-dense font-semibold text-white transition hover:opacity-90 focus-visible:outline-none"
              type="submit"
            >
              Connect account
            </button>
          </form>
        </>
      ) : (
        <p className="text-dense font-medium leading-relaxed text-text-light-gray">
          This link is invalid, expired, or belongs to another Hypertask team. Run <code>/ht connect</code> in Slack for a new link.
        </p>
      )}
    </LinkPageShell>
  );
}

function LinkPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-SVH-full items-center justify-center bg-pageBackground px-4">
      <section className="flex w-full max-w-[520px] flex-col gap-5 rounded-[5px] bg-containerBackground p-8 shadow-md">
        {children}
      </section>
    </main>
  );
}

function linkErrorMessage(status: string): string {
  if (status === "account_already_linked") {
    return "This Hypertask account is already linked to another Slack member in the workspace.";
  }
  if (status === "team_access_denied") {
    return "Your Hypertask account is not a member of the team connected to this Slack workspace.";
  }
  if (status === "invalid") {
    return "This link is invalid, expired, or has already been used. Run /ht connect in Slack for a new link.";
  }
  return "Please return to Slack and run /ht connect again.";
}
