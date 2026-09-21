import { decryptByokSecret } from "@/lib/crypto/byokCipher";
import { maskByokSecret } from "@/lib/crypto/maskByokSecret";

/**
 * The card shows whether an agent runs on its own provider account. Only the
 * masked tail is exposed; a decrypt failure reads as "no key" rather than
 * breaking the whole register. Disabled rows are not a key: resolution falls
 * back to the team credential, so the card has to say so too (HTPR-5389).
 */
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
