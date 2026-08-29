"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { useUndoContext } from "@/hooks/General/useUndo";
import type { InboxZeroPreview, InboxZeroRules } from "@/lib/inboxZero";
import { realtimeEchoHeaders } from "@/lib/realtime/client";

type InboxZeroExecuteResponse = {
  archivedCount: number;
  archivedItemCount: number;
  notificationIds: number[];
};

type InboxZeroErrorResponse = {
  message?: string;
  preview?: InboxZeroPreview;
};

export class InboxZeroPreviewChangedError extends Error {
  preview: InboxZeroPreview;

  constructor(message: string, preview: InboxZeroPreview) {
    super(message);
    this.name = "InboxZeroPreviewChangedError";
    this.preview = preview;
  }
}

const useInboxZeroActions = () => {
  const queryClient = useQueryClient();
  const { performActionAndStoreUndoData, undoAction } = useUndoContext();

  const undoInboxZero = useCallback(
    async (data: { notificationIds: number[] }, toastId: string) => {
      try {
        const response = await undoAction("UNDO_INBOX_ARCHIVE", data);
        if (response instanceof Response && !response.ok) {
          throw new Error("Unable to restore the inbox");
        }
        await queryClient.refetchQueries({ queryKey: ["inbox"] });
        toast.dismiss(toastId);
        toast("Inbox restored");
      } catch {
        toast.error("Unable to restore the inbox");
      }
    },
    [queryClient, undoAction]
  );

  /**
   * previewVersion is required on purpose. It used to be optional, and the caller
   * that omitted it made this fetch its own preview and immediately confirm it —
   * so the command palette archived the whole inbox with nobody having seen what
   * was about to go (HTPR-5613). Only a preview a person looked at can authorise
   * the archive, so the only way to call this is to hold that version.
   */
  const executeInboxZero = useCallback(
    async (
      rules: InboxZeroRules,
      previewVersion: string
    ): Promise<InboxZeroExecuteResponse> => {
      const response = await fetch("/api/notifications/inbox-zero/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...realtimeEchoHeaders(),
        },
        body: JSON.stringify({ rules, previewVersion }),
      });

      const body = (await response.json().catch(() => null)) as
        | InboxZeroExecuteResponse
        | InboxZeroErrorResponse
        | null;
      if (response.status === 409) {
        const changed = body as InboxZeroErrorResponse | null;
        if (changed?.preview) {
          throw new InboxZeroPreviewChangedError(
            changed.message ??
              "Inbox changed. Review the updated preview and confirm again.",
            changed.preview
          );
        }
      }
      if (!response.ok) {
        throw new Error(
          (body as InboxZeroErrorResponse | null)?.message ??
            "Unable to clear the inbox"
        );
      }

      const result = body as InboxZeroExecuteResponse;
      if (result.notificationIds.length > 0) {
        performActionAndStoreUndoData(
          {
            isInboxZeroOperation: true,
            notificationIds: result.notificationIds,
          },
          `Archived ${result.archivedItemCount} Inbox item${
            result.archivedItemCount === 1 ? "" : "s"
          }`,
          undoInboxZero
        );
        await queryClient.refetchQueries({ queryKey: ["inbox"] });
      } else {
        toast("No Inbox items matched");
      }

      return result;
    },
    [performActionAndStoreUndoData, queryClient, undoInboxZero]
  );

  return { executeInboxZero };
};

export default useInboxZeroActions;
