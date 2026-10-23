import type { Experimental_DownloadFunction } from "ai";
import { fetchWithoutBrotli } from "@/lib/net/fetchWithoutBrotli";
import { assertHttpUrlString, publicAddressDispatcher, readBodyWithCap } from "@/lib/mcp/attachments/safeFetch";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export async function downloadUntrustedUrl(url: URL): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let current = url;
  for (let redirects = 0; redirects <= MAX_DOWNLOAD_REDIRECTS; redirects += 1) {
    current = assertHttpUrlString(current.toString());
    const dispatcher = await publicAddressDispatcher(current, signal);
    try {
      const response = await fetchWithoutBrotli(current, { redirect: "manual", dispatcher, signal });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Download of ${current.toString()} failed with HTTP ${response.status}`);
      }
      const data = await readBodyWithCap(response, MAX_DOWNLOAD_BYTES, signal);
      return { data: new Uint8Array(data), mediaType: response.headers.get("content-type") ?? undefined };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error(`Download of ${url.toString()} followed too many redirects`);
}

export const downloadWithoutBrotli: Experimental_DownloadFunction = (requested) =>
  Promise.all(requested.map(({ url, isUrlSupportedByModel }) => (isUrlSupportedByModel ? null : downloadUntrustedUrl(url))));
