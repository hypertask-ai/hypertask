import prisma from "@/lib/prisma";
import { executeSlackAction, type SlackAction } from "@/lib/slack/actions";
import { runAsLinkedSlackUser } from "@/lib/slack/authorization";
import {
  confirmBlock,
  errorBlock,
} from "@/lib/slack/blocks";
import {
  parseSlackCommand,
  SLACK_HELP_TEXT,
  type ParsedSlackCommand,
} from "@/lib/slack/commands";
import {
  consumeSlackLinkConfirmation,
  createSlackLinkState,
  verifySlackLinkConfirmation,
} from "@/lib/slack/linkState";
import { postSlackResponseUrl } from "@/lib/slack/api";
import { claimSlackActionCapacity } from "@/lib/slack/rateLimit";
import { claimSlackEventOnce } from "@/lib/slack/taskCreateIntent";
import {
  isSlackInstallTeamMember,
  resolveSlackActor,
} from "@/lib/slack/userLink";

export type SlackCommandPayload = {
  channelId: string;
  responseUrl: string;
  slackTeamId: string;
  slackUserId: string;
  text: string;
  triggerId?: string;
};

export async function handleSlackCommand(
  payload: SlackCommandPayload,
  appOrigin: string,
): Promise<void> {
  const parsed = parseSlackCommand(payload.text);
  if (
    !(await claimSlackActionCapacity(
      payload.slackTeamId,
      payload.slackUserId,
    ))
  ) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock("Too many Slack actions. Try again in a minute."),
      true,
    );
    return;
  }
  if (parsed.subcommand === "help") {
    await postSlackResponseUrl(
      payload.responseUrl,
      [{ type: "section", text: { type: "mrkdwn", text: SLACK_HELP_TEXT } }],
      true,
    );
    return;
  }

  try {
    if (parsed.subcommand === "connect") {
      await handleConnect(payload, appOrigin, parsed.args._);
      return;
    }
    if (parsed.subcommand === "disconnect") {
      await handleDisconnect(payload);
      return;
    }

    const actor = await resolveSlackActor(payload.slackTeamId, payload.slackUserId);
    const authorized = await runAsLinkedSlackUser(actor, (linkedActor) =>
      executeSlackAction(linkedActor, toSlackAction(parsed)),
    );
    await postSlackResponseUrl(
      payload.responseUrl,
      authorized.blocks,
      true,
    );
  } catch (error) {
    console.error(`Slack command failed [${parsed.subcommand}]`, error);
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock(
        error instanceof Error ? error.message : "Something went wrong.",
        "Try again or run `/ht help`.",
      ),
      true,
    );
  }
}

async function handleConnect(
  payload: SlackCommandPayload,
  appOrigin: string,
  rawConfirmation?: string,
): Promise<void> {
  if (rawConfirmation) {
    await handleConnectConfirmation(payload, rawConfirmation);
    return;
  }
  const actor = await resolveSlackActor(payload.slackTeamId, payload.slackUserId);
  if (actor) {
    await postSlackResponseUrl(
      payload.responseUrl,
      confirmBlock(`Connected as ${actor.user.displayName || actor.user.email}.`),
      true,
    );
    return;
  }

  const install = await prisma.slackInstall.findUnique({
    where: { slackTeamId: payload.slackTeamId },
    select: { id: true },
  });
  const secret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!install || !secret) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock("This Slack workspace is not connected to Hypertask."),
      true,
    );
    return;
  }

  const state = createSlackLinkState(
    { installId: install.id, slackUserId: payload.slackUserId },
    secret,
  );
  const link = new URL("/settings/slack/link", appOrigin);
  link.searchParams.set("state", state);
  await postSlackResponseUrl(
    payload.responseUrl,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Confirm your Hypertask account in the app. This link expires in 10 minutes and works once.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Connect to Hypertask" },
            url: link.toString(),
            style: "primary",
          },
        ],
      },
    ],
    true,
  );
}

async function handleConnectConfirmation(
  payload: SlackCommandPayload,
  rawConfirmation: string,
): Promise<void> {
  const secret = process.env.SLACK_CLIENT_SECRET?.trim();
  const verified = verifySlackLinkConfirmation(rawConfirmation, secret);
  if (!verified) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock("This connection confirmation is invalid or expired."),
      true,
    );
    return;
  }

  const install = await prisma.slackInstall.findFirst({
    where: { id: verified.installId, slackTeamId: payload.slackTeamId },
    select: { id: true },
  });
  if (
    !install ||
    verified.slackUserId !== payload.slackUserId ||
    !(await isSlackInstallTeamMember(verified.installId, verified.userId))
  ) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock(
        "This confirmation belongs to a different Slack account or Hypertask team.",
      ),
      true,
    );
    return;
  }

  const confirmation = await consumeSlackLinkConfirmation(
    rawConfirmation,
    secret,
    (receiptId) => claimSlackEventOnce(prisma, receiptId),
  );
  if (!confirmation) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock("This connection confirmation has already been used."),
      true,
    );
    return;
  }

  const [slackLink, userLink] = await Promise.all([
    prisma.slackUserLink.findUnique({
      where: {
        installId_slackUserId: {
          installId: confirmation.installId,
          slackUserId: confirmation.slackUserId,
        },
      },
      select: { userId: true },
    }),
    prisma.slackUserLink.findUnique({
      where: {
        installId_userId: {
          installId: confirmation.installId,
          userId: confirmation.userId,
        },
      },
      select: { slackUserId: true },
    }),
  ]);
  if (
    (slackLink && slackLink.userId !== confirmation.userId) ||
    (userLink && userLink.slackUserId !== confirmation.slackUserId)
  ) {
    await postSlackResponseUrl(
      payload.responseUrl,
      errorBlock("One of these accounts is already connected to someone else."),
      true,
    );
    return;
  }
  if (!slackLink && !userLink) {
    try {
      await prisma.slackUserLink.create({
        data: {
          installId: confirmation.installId,
          slackUserId: confirmation.slackUserId,
          userId: confirmation.userId,
        },
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      await postSlackResponseUrl(
        payload.responseUrl,
        errorBlock("One of these accounts was connected by another request."),
        true,
      );
      return;
    }
  }

  await postSlackResponseUrl(
    payload.responseUrl,
    confirmBlock("Slack account connected to Hypertask."),
    true,
  );
}

async function handleDisconnect(payload: SlackCommandPayload): Promise<void> {
  const install = await prisma.slackInstall.findUnique({
    where: { slackTeamId: payload.slackTeamId },
    select: { id: true },
  });
  if (install) {
    await prisma.slackUserLink.deleteMany({
      where: { installId: install.id, slackUserId: payload.slackUserId },
    });
  }
  await postSlackResponseUrl(
    payload.responseUrl,
    confirmBlock("Disconnected from Hypertask."),
    true,
  );
}

function toSlackAction(parsed: ParsedSlackCommand): SlackAction {
  const { args, subcommand } = parsed;
  switch (subcommand) {
    case "create":
      return {
        action: "create_task",
        params: {
          title: args._,
          project: args.project,
          priority: args.priority,
          assignee: args.assignee ?? args.assign,
          section: args.section,
          description: args.description,
          labels: args.label ? args.label.split(",").map((label) => label.trim()) : undefined,
        },
      };
    case "search":
      return { action: "search_tasks", params: { query: args._, project: args.project } };
    case "list":
      return {
        action: "list_tasks",
        params: {
          project: args.project,
          status: args.status,
          assignee: args.assignee,
          section: args.section,
          priority: args.priority,
        },
      };
    case "view":
      return { action: "get_task", params: { ticket: args._ } };
    case "comment": {
      const [ticket, ...text] = args._.split(/\s+/);
      return { action: "add_comment", params: { ticket, content: text.join(" ") } };
    }
    case "assign": {
      const [ticket, username] = args._.split(/\s+/);
      return { action: "assign_user", params: { ticket, username } };
    }
    case "move": {
      const [ticket, ...section] = args._.split(/\s+/);
      return {
        action: "move_task",
        params: { ticket, section: section.join(" ") || args.section },
      };
    }
    case "update":
      return {
        action: "update_task",
        params: {
          ticket: args._,
          title: args.title,
          priority: args.priority,
          status: args.status,
          description: args.description,
        },
      };
    case "inbox":
      return { action: "list_inbox", params: {} };
    case "projects":
      return { action: "list_projects", params: {} };
    default:
      throw new Error(`Unknown command: ${subcommand}. Run \`/ht help\` for available commands.`);
  }
}
