"use client";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7686_FREE_PLAN_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7686-free-plan-limits";
import { HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG } from "@/lib/flags/definitions/htpr-7923-unlimited-free-tickets";
import { freePlanLimitCopy, type FreePlanLimitFlags } from "@/lib/freePlanLimits";

export function useFreePlanLimitFlags(): FreePlanLimitFlags {
  return {
    planLimits: useFlag(HTPR_7686_FREE_PLAN_LIMITS_FLAG),
    unlimitedTickets: useFlag(HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG),
  };
}

export function useFreePlanLimitCopy(): string[] {
  return freePlanLimitCopy(useFreePlanLimitFlags());
}
