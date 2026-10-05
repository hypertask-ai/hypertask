import { IDraft, IProject, ITask } from "@/models/model";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";
import { useMemo } from "react";

export const USER_DRAFTS_QUERY_KEY = (userId: number | undefined) =>
  ["drafts for user:", userId] as const;

export type IUserDraft = Omit<IDraft, "task"> & {
  task: Pick<
    ITask,
    | "id"
    | "title"
    | "projectId"
    | "uniqueIndex"
    | "ticketNumber"
    | "status"
    | "section"
  > & {
    project?: Pick<IProject, "id" | "title" | "name"> | null;
  };
};

export const getUserDrafts = async () => {
  const response = await axios.post("/api/drafts/getUserDrafts");
  if (response.status === 200) return response.data as IUserDraft[];
  return [];
};

export const useGetUserDrafts = (
  userId: number | undefined,
  initialData?: IUserDraft[]
) => {
  const document = getInboxDocument(useFirstScreenSurface(userId), userId ?? 0);
  const query = useQuery({
    queryKey: USER_DRAFTS_QUERY_KEY(userId),
    queryFn: getUserDrafts,
    enabled: Boolean(userId),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    ...(document ? { staleTime: 30 * 1000 } : {}),
    gcTime: 60 * 1000 * 60,
    initialData: initialData ?? [],
  });

  const draftTaskIds = useMemo(
    () => new Set((query.data ?? []).map((draft) => draft.taskId)),
    [query.data]
  );

  return {
    ...query,
    drafts: query.data ?? [],
    draftTaskIds,
  };
};
