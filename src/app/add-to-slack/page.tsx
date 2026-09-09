import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_4857_ADD_TO_SLACK_FLAG } from "@/lib/flags/keys";
import { SLACK_BOT_SCOPES, buildSlackAuthorizeUrl } from "@/lib/slack/authorize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Add Hypertask to Slack" };

const SCOPE_PURPOSES: Record<string, string> = {
  "app_mentions:read": "See when your team talks to the bot in Slack",
  "assistant:write": "Answer inside Slack's assistant sidebar",
  "channels:history":
    "Summarize public-channel threads you explicitly ask it to watch",
  commands: "Support the /hypertask slash command",
  "groups:history": "Same as channels:history, for private channels you add it to",
  "im:history": "Reply to your direct messages with the bot",
  "chat:write": "Post summaries, task links, and replies as the bot",
  "team:read": "Show your Slack workspace name in settings",
  "users:read": "Match Slack members to Hypertask accounts",
  "users:read.email": "Match Slack members by email address",
};

export default async function AddToSlackPage() {
  const user = await getServerCookieUser();
  // Anonymous visitors pass -1: only an EVERYONE flag passes the mode check.
  if (!(await isFeatureEnabled(HTPR_4857_ADD_TO_SLACK_FLAG, user?.id ?? -1))) {
    notFound();
  }

  const headerList = await headers();
  // Allowlist-validated host; falls back to the canonical app origin, so a
  // poisoned forwarded-host header cannot steer the Slack redirect_uri.
  const authorizeUrl = buildSlackAuthorizeUrl(
    getRequestBaseUrl(
      new Request("https://hypertask.internal", { headers: headerList }),
    ),
  );

  return (
    <main className="flex min-h-SVH-full items-center justify-center bg-pageBackground px-4">
      <section className="flex w-full max-w-[520px] flex-col gap-5 rounded-[5px] bg-containerBackground p-8 shadow-md">
        <h1 className="text-heading font-semibold text-white-black">
          Hypertask for Slack
        </h1>
        <p className="text-dense font-medium leading-relaxed text-text-light-gray">
          Turn Slack conversations into tracked tasks. Mention the bot to create
          a task from any message, ask it to watch a thread and post a summary,
          and chat with it in Slack&apos;s assistant sidebar.
        </p>
        {authorizeUrl ? (
          <a
            href={authorizeUrl.toString()}
            className="rounded-lg bg-primary px-6 py-3 text-center font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Add to Slack
          </a>
        ) : (
          <p className="text-dense font-medium text-text-light-gray">
            Slack installation is not configured yet. Please try again later.
          </p>
        )}
        <div>
          <h2 className="text-dense font-semibold text-white-black">
            What the bot can read
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {SLACK_BOT_SCOPES.map((scope) => (
              <li
                key={scope}
                className="text-dense font-medium text-text-light-gray"
              >
                <code className="bg-pageBackground px-1">{scope}</code> —{" "}
                {SCOPE_PURPOSES[scope] ?? scope}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-dense font-medium leading-relaxed text-text-light-gray">
          After Slack adds the bot, sign in to Hypertask to connect it to your
          team. When you remove the app from your workspace, we delete the bot
          token and everything stored for it.
        </p>
      </section>
    </main>
  );
}
