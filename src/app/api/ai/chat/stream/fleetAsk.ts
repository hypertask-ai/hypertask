/**
 * The fleet ask bridge: one place that knows AGENT_FLEET_ASK_URL's request and
 * response contract. The hypertask_ask_agent tool and the HTPR-6284 routed
 * @mention turn both go through this, so validation cannot drift between them.
 */

export type FleetAskResult =
  | { success: true; answer: string }
  | { success: false; error: string };

export const FLEET_ASK_TIMEOUT_MS = 45_000;

// Answers are rendered in the chat as model output would be; the cap only
// stops a runaway runtime reply from pinning the stream. ponytail: the bridge
// has no pagination — if agents start returning long reports, stream chunks
// instead of one string.
export const FLEET_ASK_MAX_ANSWER_LENGTH = 20_000;

export async function askFleetAgent(input: {
  agentId: string;
  question: string;
  context: {
    boardId: number;
    taskId?: unknown;
    requesterName?: string;
  };
  abortSignal?: AbortSignal;
}): Promise<FleetAskResult> {
  const url = process.env.AGENT_FLEET_ASK_URL;
  const secret = process.env.AGENT_FLEET_ASK_SECRET;
  if (!url || !secret) {
    return { success: false, error: "Agent bridge is not configured." };
  }

  const controller = new AbortController();
  // A signal that was already aborted never fires its listener, so check it
  // before the request instead of after.
  if (input.abortSignal?.aborted) {
    return { success: false, error: "aborted" };
  }
  const timeout = setTimeout(() => controller.abort(), FLEET_ASK_TIMEOUT_MS);
  // Stop in the chat must also stop the bridge wait, not just abandon it.
  const forwardAbort = () => controller.abort();
  input.abortSignal?.addEventListener("abort", forwardAbort);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fleet-ask-secret": secret,
      },
      body: JSON.stringify({
        agentId: input.agentId,
        question: input.question,
        context: input.context,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: "The agent request failed." };
    }

    const result = (await response.json()) as {
      success?: boolean;
      answer?: string;
    };
    if (
      !result.success ||
      typeof result.answer !== "string" ||
      !result.answer.trim()
    ) {
      return { success: false, error: "The agent returned a malformed response." };
    }

    const answer = result.answer.trim();
    if (answer.length > FLEET_ASK_MAX_ANSWER_LENGTH) {
      return {
        success: false,
        error: "The agent returned a response that was too large to deliver.",
      };
    }

    return { success: true, answer };
  } catch (error) {
    if (input.abortSignal?.aborted) {
      return { success: false, error: "aborted" };
    }
    console.error("[AI chat ask agent]", error);
    return {
      success: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "The agent did not respond in time."
          : "The agent request failed.",
    };
  } finally {
    input.abortSignal?.removeEventListener("abort", forwardAbort);
    clearTimeout(timeout);
  }
}
