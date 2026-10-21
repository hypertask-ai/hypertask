import { SSE_HEADERS } from "@/lib/ai/tools/constants";
import { runChatStream } from "./runStream";
import type { StreamOptions, StreamState } from "./streamState";

export function createChatStream(options: StreamOptions) {
  const state = { ...options, encoder: new TextEncoder(), clientConnected: true } as StreamState;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await runChatStream(controller, state);
    },
    cancel() {
      state.clientConnected = false;
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
