"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPricingSettingsPath } from "@/lib/pricingSettingsPaths";
import type { preSelectParamPricing } from "@/models/model";

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
