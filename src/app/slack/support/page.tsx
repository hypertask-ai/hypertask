import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6921_SLACK_MARKETPLACE_FLAG } from "@/lib/flags/keys";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hypertask for Slack support" };

export default async function SlackSupportPage() {
  const user = await getServerCookieUser();
  if (!(await isFeatureEnabled(HTPR_6921_SLACK_MARKETPLACE_FLAG, user?.id ?? -1))) {
    notFound();
  }

  return (
    <main className="flex min-h-SVH-full items-center justify-center bg-pageBackground px-4">
      <section className="flex w-full max-w-[520px] flex-col gap-5 rounded-[5px] bg-cardBackground px-4 py-4 shadow-md">
        <h1 className="text-heading font-semibold text-white-black">
          Hypertask for Slack support
        </h1>
        <p className="text-content leading-relaxed text-text-light-gray">
          Create, find, and update Hypertask tasks with <code>/ht</code>, bot
          mentions, direct messages, or Slack&apos;s assistant sidebar. Turn a
          Slack thread into a task and get summaries on linked Hypertask tickets.
          Actions use your linked account&apos;s Hypertask permissions.
        </p>
        <div>
          <h2 className="text-dense font-semibold text-white-black">Connect and disconnect</h2>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            In Hypertask, open Settings, then Slack, select your team, and choose
            Connect Slack. You can also start from <Link href="/add-to-slack" className="underline">Add to Slack</Link>,
            then sign in and finish connecting in Settings. Set a default project
            for tasks created from threads. Each Hypertask team connects to one
            Slack workspace; organization-wide installs are not supported.
          </p>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            Run <code>/ht connect</code> and follow the confirmation steps to link
            your personal account. A confirmed Slack email can also link
            automatically to exactly one verified member of the connected
            Hypertask team. Run <code>/ht disconnect</code> to remove your personal
            link. With the Slack app rollout enabled, this also blocks automatic
            relinking until you run <code>/ht connect</code> again. To disconnect
            the whole team, use Disconnect in Hypertask&apos;s Slack settings;
            this does not uninstall the app from Slack.
          </p>
        </div>
        <div>
          <h2 className="text-dense font-semibold text-white-black">Data and retention</h2>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            The app reads messages directed to it, thread messages needed for
            requested task creation and watched-thread summaries, workspace
            information, and member profiles including email for account linking.
            Private-channel access requires adding the bot to that channel.
            Relevant message text is sent to your team&apos;s configured AI service
            to interpret requests and generate tasks or summaries.
          </p>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            We store an encrypted bot token, workspace ID and name, bot and
            installer IDs, your connected Hypertask team and default project,
            account links, and watched-thread checkpoints with channel IDs,
            timestamps, and linked task IDs. Event and command receipts prevent
            duplicate actions. Tasks and comments, including generated summaries
            and Slack thread links, remain as normal Hypertask content.
          </p>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            With the Slack app rollout enabled, Redis retains recent conversation
            text and bot results, capped at 8,000 bytes per history, plus assistant
            channel, workspace, and enterprise metadata. Context is isolated by
            install, Slack user, channel, thread, and Hypertask user. It expires
            24 hours after the latest history or context write. Redis also holds
            short-lived rate-limit counters and personal disconnect markers;
            disconnect markers have no expiry and are cleared on reconnect.
          </p>
        </div>
        <div>
          <h2 className="text-dense font-semibold text-white-black">Uninstall</h2>
          <p className="mt-2 text-content leading-relaxed text-text-light-gray">
            Open Hypertask in Slack&apos;s app management, then remove the app
            from your workspace. When Slack delivers the uninstall or bot-token
            revocation event, we delete the installation, encrypted token,
            watched-thread checkpoints, and account links. Hypertask tasks,
            comments, and deduplication receipts remain. Redis chat context is
            not immediately purged; it expires after its 24-hour retention window.
            Disconnect markers remain under the old install ID and do not apply
            to a new install.
          </p>
        </div>
        <p className="text-content leading-relaxed text-text-light-gray">
          Need help? Email <a href="mailto:help@hypertask.ai" className="underline">help@hypertask.ai</a>.
          Include what you tried and any error message, but never send tokens or passwords.
        </p>
        <p className="text-dense text-text-light-gray">
          <a href="https://hypertask.ai/privacy/" className="underline">Privacy policy</a>
          {" · "}
          <a href="https://hypertask.ai/terms/" className="underline">Terms</a>
        </p>
      </section>
    </main>
  );
}
