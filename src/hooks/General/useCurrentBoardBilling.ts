import { currentBoardBillingAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";

export function useCurrentBoardBilling() {
  return useRecoilValue(currentBoardBillingAtom);
}
