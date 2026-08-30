import type { BoardRouteSearchParams } from "@/lib/boardRouteTitle";

type BoardRoutePathResolution =
  | { kind: "canonical" }
  | { kind: "redirect"; projectId: string }
  | { kind: "not-found" };

export const resolveBoardRoutePath = (
  boardURL: string[] | undefined,
): BoardRoutePathResolution => {
  if (boardURL?.length === 1 && boardURL[0] === "project") {
    return { kind: "canonical" };
  }

  if (boardURL?.length === 1) {
    const match = /^project-(\d+)$/.exec(boardURL[0]);
    const projectId = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(projectId) && projectId > 0) {
      return { kind: "redirect", projectId: String(projectId) };
    }
  }

  return { kind: "not-found" };
};

export const buildCanonicalBoardUrl = (
  projectId: string,
  searchParams: BoardRouteSearchParams,
) => {
  const canonicalParams = new URLSearchParams({ id: projectId });

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "id" || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => canonicalParams.append(key, item));
    } else {
      canonicalParams.append(key, value);
    }
  }

  return `/project?${canonicalParams.toString()}`;
};
