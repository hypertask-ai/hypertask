export function describeTaskWriterStreamFailure(text: string): string | null {
  for (const match of text.matchAll(/event: error\r?\ndata: ([^\r\n]+)\r?\n\r?\n/g)) {
    try {
      const error = JSON.parse(match[1]);
      if (error.code === "empty-task-writer-draft" || error.code === "task-writer-stream-error" || error.code === "PLAN_LIMIT_REACHED") {
        if (typeof error.message === "string" && error.message.trim()) return error.message;
        if (typeof error.content === "string") return error.content;
      }
    } catch {
    }
  }
  return null;
}

export async function describeTaskWriterFailure(
  response: Response
): Promise<string> {
  if (response.status === 413) {
    return "This task is too large to send to the AI. Large images pasted into the description are the usual cause: remove one, or attach it as a file instead.";
  }
  try {
    const body = await response.json();
    if (typeof body?.message === "string" && body.message.trim()) return body.message;
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
  }
  return `The AI request failed (${response.status}). Please try again.`;
}
