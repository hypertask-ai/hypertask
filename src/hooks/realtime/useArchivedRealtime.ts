import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IProject, IProjectsAll, IUser } from "@/models/model";
import { getAllProjects } from "@/utils/api/Homepage";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import {
  BOARD_EVENT,
  INBOX_EVENT,
  boardChannel,
  userChannel,
} from "@/lib/realtime/shared";

const extractProjectIds = (projectsAll: unknown): number[] => {
  const projects = Array.isArray(projectsAll)
    ? projectsAll
    : (projectsAll as IProjectsAll | undefined)?.updatedProjects;

  if (!Array.isArray(projects)) return [];

  return Array.from(
    new Set(
      projects
        .map((project: IProject) => project.id)
        .filter((projectId): projectId is number => typeof projectId === "number")
    )
  ).sort((a, b) => a - b);
};

const areSameProjectIds = (left: number[], right: number[]) =>
  left.length === right.length &&
  left.every((projectId, index) => projectId === right[index]);

export const createArchivedRealtimeEventHandler = (refetch: () => void) => {
  return () => refetch();
};

export function useArchivedRealtime(userId: number | null | undefined): void {
  const queryClient = useQueryClient();
  const inboxWasConnected = useRef(false);
  const boardWasConnected = useRef(false);
  const [projectIds, setProjectIds] = useState<number[]>(() =>
    extractProjectIds(queryClient.getQueryData(["projectsAll"]))
  );

  // On a direct visit to /archived (deep link, hard refresh, new tab) the
  // ["projectsAll"] cache the board channels are derived from is never primed,
  // so Tasks Archive would get zero subscriptions and silently not live-update.
  // Fetch it once ourselves so the board effect below has projectIds to work with.
  useEffect(() => {
    if (userId == null) return;
    if (queryClient.getQueryData(["projectsAll"])) return;
    void queryClient
      .prefetchQuery({
        queryKey: ["projectsAll"],
        queryFn: () => getAllProjects({ id: userId } as IUser, null),
        staleTime: 30 * 1000,
      })
      .catch(() => undefined);
  }, [queryClient, userId]);

  useEffect(() => {
    const updateProjectIds = () => {
      const nextProjectIds = extractProjectIds(
        queryClient.getQueryData(["projectsAll"])
      );
      setProjectIds((currentProjectIds) =>
        areSameProjectIds(currentProjectIds, nextProjectIds)
          ? currentProjectIds
          : nextProjectIds
      );
    };

    updateProjectIds();

    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "projectsAll") updateProjectIds();
    });
  }, [queryClient]);

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const refetch = () => {
      void queryClient.refetchQueries({ queryKey: ["archivedInbox"] });
      void queryClient.refetchQueries({ queryKey: ["archivedInboxMeta"] });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = userChannel(userId);
      const channel = client.subscribe(channelName);
      const onInboxEvent = createArchivedRealtimeEventHandler(refetch);
      channel.bind(INBOX_EVENT, onInboxEvent);
      if (client.connection.state === "connected") inboxWasConnected.current = true;
      const onConnected = () => {
        if (inboxWasConnected.current) refetch();
        inboxWasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channel.unbind(INBOX_EVENT, onInboxEvent);
        client.connection.unbind("connected", onConnected);
        // No client.unsubscribe() here: the always-mounted useInboxRealtime owns
        // this same private-user channel; unsubscribing on /archived unmount
        // would silently kill inbox realtime for the rest of the session.
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, userId]);

  useEffect(() => {
    if (projectIds.length === 0) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const refetch = () => {
      void queryClient.refetchQueries({ queryKey: ["archived"] });
      void queryClient.refetchQueries({ queryKey: ["archivedMeta"] });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelNames = projectIds.map((projectId) => boardChannel(projectId));
      const channels = channelNames.map((channelName) => {
        const channel = client.subscribe(channelName);
        const onBoardEvent = createArchivedRealtimeEventHandler(refetch);
        channel.bind(BOARD_EVENT, onBoardEvent);
        return { channel, onBoardEvent };
      });

      if (client.connection.state === "connected") boardWasConnected.current = true;
      const onConnected = () => {
        if (boardWasConnected.current) refetch();
        boardWasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channels.forEach(({ channel, onBoardEvent }) =>
          channel.unbind(BOARD_EVENT, onBoardEvent)
        );
        client.connection.unbind("connected", onConnected);
        channelNames.forEach((channelName) => client.unsubscribe(channelName));
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [projectIds, queryClient]);
}
