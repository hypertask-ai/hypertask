import { gatewayFundingSourceForApiKey, type AiModelCredential } from "@/app/api/ai/_lib/modelProvider";

export function fallbackRunsOnOurOwnGatewayKey(credential: AiModelCredential | undefined): boolean {
  return typeof credential === "string" && gatewayFundingSourceForApiKey(credential) === "shared";
}
