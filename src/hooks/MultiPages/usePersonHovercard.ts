import { useQuery } from "@tanstack/react-query";
import type {
  PersonHovercardProfile,
  PersonHovercardSubject,
} from "@/models/personHovercard";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";

export const personHovercardQueryKey = (
  viewerId: number,
  projectId: number,
  subject: PersonHovercardSubject,
) => ["personHovercard", viewerId, projectId, subject.kind, subject.id] as const;

async function fetchPersonHovercard(
  projectId: number,
  subject: PersonHovercardSubject,
): Promise<PersonHovercardProfile> {
  const params = new URLSearchParams({
    projectId: String(projectId),
    kind: subject.kind,
    id: String(subject.id),
  });
  const response = await fetch(`/api/members/personHovercard?${params}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json()) as PersonHovercardProfile & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? "Failed to load person");
  }
  return body;
}

export function usePersonHovercard(
  projectId: number | undefined,
  subject: PersonHovercardSubject | null,
  enabled = true,
) {
  const currentUser = useRecoilValue(currentUserAtom);
  const viewerId = Number(currentUser?.id);
  const canLoad =
    enabled &&
    Number.isSafeInteger(viewerId) &&
    viewerId > 0 &&
    typeof projectId === "number" &&
    projectId > 0 &&
    subject !== null;

  return useQuery({
    queryKey: canLoad
      ? personHovercardQueryKey(viewerId, projectId, subject)
      : ["personHovercard", "disabled", viewerId || null],
    queryFn: () => fetchPersonHovercard(projectId!, subject!),
    enabled: canLoad,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
