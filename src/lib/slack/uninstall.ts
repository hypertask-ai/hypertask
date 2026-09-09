// HTPR-4857: Slack uninstall/revoke cleanup. Slack's Marketplace review requires
// a real deletion story: when the app is removed from a workspace (or its bot
// token is revoked), everything we stored for that install must go. Cascades
// take the watched-thread checkpoints and user links with the install row.

import { decryptSecret } from "@/lib/crypto/byokCipher";

// Minimal DB surface so tests can run without Prisma.
export type SlackInstallRow = {
  id: string;
  encryptedBotToken: string;
  updatedAt: Date;
};

export type SlackInstallDb = {
  slackInstall: {
    findUnique(args: {
      where: { slackTeamId: string };
      select: {
        id: true;
        encryptedBotToken: true;
        updatedAt: true;
      };
    }): Promise<SlackInstallRow | null>;
    deleteMany(args: {
      where: {
        id: string;
        updatedAt?: { lt: Date };
      };
    }): Promise<{ count: number }>;
  };
};

export type SlackRevocationEvent = {
  type?: string;
  // tokens_revoked payload: the actual revoked token strings, split by kind.
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
  | "skipped_reinstalled";

// Returns true when one of the revoked tokens is this install's bot token.
function botTokenRevoked(
  revokedBotTokens: string[],
  encryptedBotToken: string,
): boolean {
  if (revokedBotTokens.length === 0) return false;
  // decryptSecret throws on malformed ciphertext; a row we cannot decrypt is
  // dead weight either way, so treat the bot as revoked.
  try {
    const decrypted = decryptSecret(encryptedBotToken);
    return revokedBotTokens.includes(decrypted);
  } catch {
    return true;
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
      encryptedBotToken: true,
      updatedAt: true,
    },
  });
  if (!install) return "unknown_workspace";

  if (event.type === "tokens_revoked") {
    // Only the bot's own revocation ends the install; a member's user OAuth
    // token being revoked does not invalidate it.
    if (!botTokenRevoked(event.tokens?.bot ?? [], install.encryptedBotToken)) {
      return "skipped_not_bot";
    }
  } else if (event.type !== "app_uninstalled") {
    return "skipped_not_bot";
  }

  // The event can lag a fast uninstall/reinstall cycle; never delete a row
  // written after the event happened. The predicate makes check and delete
  // one atomic statement, so a reinstall racing the event is safe. Real Slack
  // deliveries always carry a timestamp; without one we skip and wait for the
  // retry rather than risk deleting a fresh reinstall. Slack's event_ts has
  // whole-second precision, so the cutoff compares at second granularity.
  const eventTsSeconds = Number(
    event.event_ts ?? envelope.event_time ?? Number.NaN,
  );
  if (!Number.isFinite(eventTsSeconds)) return "skipped_reinstalled";
  const deleted = await db.slackInstall.deleteMany({
    where: {
      id: install.id,
      updatedAt: { lt: new Date((eventTsSeconds + 1) * 1000) },
    },
  });
  return deleted.count > 0 ? "deleted" : "skipped_reinstalled";
}
