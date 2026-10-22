import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7551_START_PLAN_CHECKOUT_FLAG } from "@/lib/flags/keys";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import { useGetAllAccessibleBoardList } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import type { IProject } from "@/models/model";

export function TeamStartPlanButton({ teamId }: { teamId?: string }) {
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const enabled = useFlag(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
  const flagReady = useFlagReady(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
  const selectedTeamBoard = teamId && currentProject?.team?.id === teamId && currentProject.id
    ? currentProject : undefined;
  const boards = useGetAllAccessibleBoardList(currentUser, {
    enabled: flagReady && enabled && Boolean(teamId) && !selectedTeamBoard,
  });
  const checkoutBoard = selectedTeamBoard ?? boards.data?.find((board) =>
    board.id && board.team?.id === teamId);

  if (!flagReady || !enabled) return null;
  if (!teamId) return <span role="status">Loading team…</span>;
  if (checkoutBoard) return <StartPlanButton project={checkoutBoard} teamId={teamId} />;
  if (boards.isError) return <div role="status">Could not load this team&apos;s boards. <button type="button" onClick={() => void boards.refetch()}>Retry</button></div>;
  return <span role="status">{boards.isLoading ? "Loading this team's boards…" : "Open a board in this team to start a plan"}</span>;
}

export async function requestCheckout(body: unknown): Promise<string> {
  const response = await axios.post("/api/stripe/session/checkout", body);
  const url = response.data?.url;
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Checkout is not ready. Please try again.");
  }
  return url;
}

function checkoutError(error: unknown): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return error instanceof Error ? error.message : "Could not start checkout. Please try again.";
}

type PlanAccess = { canStartPlan?: boolean; trialDays?: number; finishing?: boolean };

export function StartPlanButton({ project, teamId, compact = false }: {
  project?: IProject;
  teamId?: string;
  compact?: boolean;
}) {
  const selectedProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const board = project ?? selectedProject;
  const billing = deriveCurrentBoardBilling(board ?? null);
  const enabled = useFlag(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
  const eligibleBoard = Boolean(currentUser?.id && board?.id && Array.isArray(board.team?.subscriptionPlan) && billing?.storePlanId === "Free" &&
    (!teamId || billing.teamId === teamId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const boardUrl = typeof window !== "undefined" && board?.id
    ? window.location.pathname === "/project" && new URLSearchParams(window.location.search).get("id") === String(board.id)
      ? window.location.href
      : `${window.location.origin}/project?id=${board.id}`
    : null;
  const body = { intent: "signup-straight-to-board", teamId: billing?.teamId, boardUrl };
  const access = useQuery<PlanAccess>({
    queryKey: ["start-plan-access", currentUser?.id, billing?.teamId, boardUrl, enabled],
    enabled: enabled && eligibleBoard && Boolean(boardUrl),
    queryFn: async () => (await axios.post("/api/stripe/session/checkout", { ...body, action: "preview" })).data,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.finishing ? 2000 : false,
  });

  useEffect(() => {
    if (!enabled || !access.data?.finishing) return;
    void queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
    void queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] });
    router.refresh();
  }, [enabled, access.data, queryClient, router]);

  if (!enabled || !eligibleBoard) return null;
  if (board?.team.googleAccount?.userId !== undefined && board.team.googleAccount.userId !== currentUser.id) {
    return <span className="text-content text-text-light-gray">Only the team owner can start a plan</span>;
  }
  if (access.isError) {
    const message = checkoutError(access.error);
    if (/team owner/i.test(message)) return <span className="text-content text-text-light-gray">Only the team owner can start a plan</span>;
    if (/Only Free teams|existing subscription/i.test(message)) return null;
    return <div role="status" className="text-content text-text-light-gray">{message} <button type="button" onClick={() => void access.refetch()}>Retry</button></div>;
  }
  if (access.data?.finishing) return <span role="status" className="text-content text-text-light-gray">Finishing plan setup…</span>;
  if (!access.data?.canStartPlan) return compact ? null : <span role="status">{access.isFetching || !access.data
    ? "Checking plan access…" : "Open billing settings to manage this team's plan"}</span>;

  const createCheckout = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const url = await requestCheckout(body);
      router.push(url);
    } catch (failure) {
      setError(checkoutError(failure));
      submitting.current = false;
      setPending(false);
      void access.refetch();
    }
  };

  return <div className={compact ? "ml-3 flex flex-col" : "flex flex-col gap-1"}>
    <button type="button" disabled={pending || access.isFetching} onClick={createCheckout}
      className={`rounded-[5px] bg-white-black py-1 text-content font-medium text-white-black-inverted hover:opacity-90 disabled:opacity-50 ${compact ? "px-3" : "min-w-[280px] px-10"}`}>
      {pending ? "Opening checkout…" : "Start a Hypertask plan"}
    </button>
    <span className="text-meta text-text-light-gray">{access.data.trialDays === 7
      ? "$20 per user/month after 7 days"
      : "$20 per user/month"}</span>
    {error && <span role="alert" className="text-content text-text-light-gray">{error}</span>}
  </div>;
}
