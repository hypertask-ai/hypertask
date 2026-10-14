import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { maskByokSecret } from "@/lib/crypto/maskByokSecret";

export function maskAgentProviderKey(
  rows: { provider: string; ciphertext: string | null; enabled?: boolean }[],
): { provider: string; maskedKey: string } | null {
  for (const row of rows) {
    if (row.enabled === false) continue;
    const ciphertext = row.ciphertext?.trim();
    if (!ciphertext) continue;
    try {
      return {
        provider: row.provider,
        maskedKey: maskByokSecret(decryptByokSecret(ciphertext)),
      };
    } catch (error) {
      console.error(
        `[agents] provider key decrypt failed for provider=${row.provider}`,
        error,
      );
    }
  }
  return null;
}
