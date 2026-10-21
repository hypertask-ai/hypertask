import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7551_START_PLAN_CHECKOUT_FLAG } from "@/lib/flags/definitions/htpr-7551-start-plan-checkout";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import type { IProject } from "@/models/model";

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
  if (!access.data?.canStartPlan) return null;

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
      className={compact ? "btn btn-dark px-3 py-1 text-content disabled:opacity-50" : "min-w-[280px] px-10 font-semibold text-content btn btn-dark disabled:opacity-50"}>
      {pending ? "Opening checkout…" : "Start a Hypertask plan"}
    </button>
    <span className="text-meta text-text-light-gray">{access.data.trialDays === 7
      ? "$20 per user/month after 7 days"
      : "$20 per user/month"}</span>
    {error && <span role="alert" className="text-content text-text-light-gray">{error}</span>}
  </div>;
}
