import type { preSelectParamPricing } from "@/models/model";

export const getPricingSettingsPath = (
  preSelect?: preSelectParamPricing,
): string => {
  switch (preSelect) {
    case "API Keys":
      return "/settings/apiKeys";
    case "Billing":
      return "/settings/billing";
    case "Members":
      return "/settings/members";
    case "Settings":
      return "/settings/general";
    case "Upgrade":
    default:
      return "/settings/plans";
  }
};
