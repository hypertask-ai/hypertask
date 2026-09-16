// HTPR-4857: Slack uninstall/revoke cleanup. Slack's Marketplace review requires
// a real deletion story: when the app is removed from a workspace (or its bot
// token is revoked), everything we stored for that install must go. Cascades
// take the watched-thread checkpoints and user links with the install row.

import { decryptSecret } from "@/lib/crypto/byokCipher";

// Minimal DB surface so tests can run without Prisma.
export type SlackInstallRow = {
  id: string;
  botUserId: string;
  encryptedBotToken: string;
  updatedAt: Date;
};

export type SlackInstallDb = {
  slackInstall: {
    findUnique(args: {
      where: { slackTeamId: string };
      select: {
        id: true;
        botUserId: true;
        encryptedBotToken: true;
        updatedAt: true;
      };
    }): Promise<SlackInstallRow | null>;
    deleteMany(args: {
      where: {
        id: string;
        updatedAt?: { lte: Date };
      };
    }): Promise<{ count: number }>;
  };
};

export type SlackRevocationEvent = {
  type?: string;
  // tokens_revoked payload: Slack sends user IDs, not secret token strings.
  tokens?: {
    oauth?: string[];
    bot?: string[];
  };
  event_ts?: string;
};

export type SlackRevocationEnvelope = {
  team_id?: string;
  event?: SlackRevocationEvent;
  event_time?: number;
};

export type SlackRevocationResult =
  | "deleted"
  | "unknown_workspace"
  | "skipped_not_bot"
  | "skipped_reinstalled"
  | "skipped_missing_timestamp"
  | "skipped_undecryptable";

type BotTokenMatch = boolean | "undecryptable";

// Slack documents tokens.bot as bot user IDs. Accept those, and still accept
// a leaked xoxb string if one ever appears.
function botTokenRevoked(
  revokedBotIds: string[],
  install: SlackInstallRow,
): BotTokenMatch {
  if (revokedBotIds.length === 0) return false;
  if (revokedBotIds.includes(install.botUserId)) return true;
  try {
    const decrypted = decryptSecret(install.encryptedBotToken);
    return revokedBotIds.includes(decrypted);
  } catch (error) {
    // Indeterminate: do not delete, and do not pretend this was a foreign
    // token. The events route returns 500 so Slack retries.
    console.error("Slack install token could not be decrypted", error);
    return "undecryptable";
  }
}

export async function deleteSlackInstallForRevocation(
  db: SlackInstallDb,
  envelope: SlackRevocationEnvelope,
): Promise<SlackRevocationResult> {
  const event = envelope.event;
  if (!event?.type) return "unknown_workspace";
  const teamId = envelope.team_id?.trim();
  if (!teamId) return "unknown_workspace";

  const install = await db.slackInstall.findUnique({
    where: { slackTeamId: teamId },
    select: {
      id: true,
      botUserId: true,
      encryptedBotToken: true,
      updatedAt: true,
    },
  });
  if (!install) return "unknown_workspace";

  if (event.type === "tokens_revoked") {
    // Only the bot's own revocation ends the install; a member's user OAuth
    // token being revoked does not invalidate it.
    const botMatch = botTokenRevoked(event.tokens?.bot ?? [], install);
    if (botMatch === "undecryptable") return "skipped_undecryptable";
    if (!botMatch) return "skipped_not_bot";
  } else if (event.type !== "app_uninstalled") {
    return "skipped_not_bot";
  }

  // The event can lag a fast uninstall/reinstall cycle; never delete a row
  // written after the event happened. The predicate makes check and delete
  // one atomic statement, so a reinstall racing the event is safe. Real Slack
  // deliveries always carry a timestamp; without one we skip and wait for the
  // retry rather than risk deleting a fresh reinstall. Residual edge: an
  // uninstall in the same second the row was written leaves the row until
  // Slack retries; deleting fresh installs would be worse.
  const eventTsSeconds = Number(
    event.event_ts ?? envelope.event_time ?? Number.NaN,
  );
  if (!Number.isFinite(eventTsSeconds)) return "skipped_missing_timestamp";
  const deleted = await db.slackInstall.deleteMany({
    where: {
      id: install.id,
      updatedAt: { lte: new Date(eventTsSeconds * 1000) },
    },
  });
  return deleted.count > 0 ? "deleted" : "skipped_reinstalled";
}
