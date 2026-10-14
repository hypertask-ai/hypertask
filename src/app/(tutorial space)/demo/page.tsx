import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7141_DEMO_GUEST_RETRY_FLAG } from "@/lib/flags/keys";

import DemoBoardPage from "./DemoBoardPage";

export default async function DemoPage() {
  const retryNetworkErrors = await isFeatureEnabled(HTPR_7141_DEMO_GUEST_RETRY_FLAG, -1).catch(() => false);
  return <DemoBoardPage retryNetworkErrors={retryNetworkErrors} />;
}
