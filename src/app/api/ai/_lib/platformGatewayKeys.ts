import registry from "../../../../../config/managed-team-gateway-keys.json";

const platformGatewayEnvNames = [...new Set(registry.map((row) => row.credentialEnv))];

export function isPlatformManagedGatewayKey(apiKey: string): boolean {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("vck_")) return false;
  return platformGatewayEnvNames.some((name) => process.env[name]?.trim() === normalized);
}
