import { hasHaikuByokProvider } from "@/lib/aiModelOptions";
import type { CurrentBoardBilling } from "@/store";

type ByokBillingPick = Pick<
  CurrentBoardBilling,
  "storePlanId" | "byokProviderFlags"
>;

export function shouldBlockAiDueToByokProvider(
  _billing: ByokBillingPick | null | undefined,
  _selectedSource: string | undefined | null
): boolean {
  return false;
}

export function isByokProviderEnabledForSource(
  byokProviderFlags: ByokBillingPick["byokProviderFlags"] | undefined,
  source: string | undefined | null
): boolean {
  if (!source) return false;
  if (
    byokProviderFlags?.some(
      (row) => row.provider === "gateway" && row.enabled
    )
  ) {
    return true;
  }
  if (source === "gateway") return false;
  return !!byokProviderFlags?.find((r) => r.provider === source)?.enabled;
}

export function hasHaikuByokProviderFlags(byokProviderFlags: ByokBillingPick["byokProviderFlags"] | undefined): boolean {
  return hasHaikuByokProvider(new Set(byokProviderFlags?.filter((row) => row.enabled).map((row) => row.provider)));
}
