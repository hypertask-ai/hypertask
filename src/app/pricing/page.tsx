"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPricingSettingsPath } from "@/lib/pricingSettingsPaths";
import type { preSelectParamPricing } from "@/models/model";

// /pricing is a redirect shim into the Settings > Plans section. A server-side
// `redirect()` here rendered the root error boundary instead of issuing a 307
// (the NEXT_REDIRECT bubbled up as a 200 error page), which broke the Stripe
// checkout return URL (`/pricing?success=1`). Redirect on the client instead:
// /settings/plans renders fine client-side, so this always resolves.
export default function PricingRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const preSelect =
      (searchParams?.get("preSelect") as preSelectParamPricing | null) ??
      undefined;
    const destination = getPricingSettingsPath(preSelect);
    const success = searchParams?.get("success") === "1" ? "?success=1" : "";
    router.replace(`${destination}${success}`);
  }, [router, searchParams]);

  return null;
}
