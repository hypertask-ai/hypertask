
import { decryptSecret } from "@/lib/crypto/byokCipher";

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
    const botMatch = botTokenRevoked(event.tokens?.bot ?? [], install);
    if (botMatch === "undecryptable") return "skipped_undecryptable";
    if (!botMatch) return "skipped_not_bot";
  } else if (event.type !== "app_uninstalled") {
    return "skipped_not_bot";
  }

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
