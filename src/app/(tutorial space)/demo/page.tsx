import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7141_DEMO_GUEST_RETRY_FLAG } from "@/lib/flags/keys";

import DemoBoardPage from "./DemoBoardPage";

export default async function DemoPage() {
  // Anonymous visitors do not load the signed-in client flag provider.
  const retryNetworkErrors = await isFeatureEnabled(HTPR_7141_DEMO_GUEST_RETRY_FLAG, -1).catch(() => false);
  return <DemoBoardPage retryNetworkErrors={retryNetworkErrors} />;
}
